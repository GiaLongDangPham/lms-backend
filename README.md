# LMS Backend · Nhóm 2

S1/D1 + B1 local: Express + TypeScript, PostgreSQL; đăng nhập JWT, tài khoản, lớp và ghi danh.
Đã bổ sung luồng nộp/chấm/công bố theo Client Log 18–20 và L04/L05/L14/L20 ngày 17/10.
Long phụ trách S1/D1/B1/B2/B6 và tích hợp; Nam làm
D2/B3/B4/B5. Nam review backend của Long; Long review backend của Nam.

Cập nhật tuần 02 (25/10/2026): đã bổ sung B1 ghi danh hàng loạt và B2 tài liệu,
upload/download riêng tư. [Spec D1/B1/B2/F2](docs/superpowers/specs/D1-B1-B2-F2-tuan-02.md)
mô tả thiết kế và tiêu chí nghiệm thu; [implementation plan](docs/superpowers/plans/D1-B1-B2-F2-tuan-02.md)
chứa checklist, evidence, cấu hình S3/cleanup và các bước staging/review còn lại.
Xem [mục lục specs/plans](docs/superpowers/README.md) để theo dõi cùng team.

Cập nhật B6 (13/11/2026): đã implement API Comment cho bài tập và bài nộp,
có kiểm thử HTTP/PostgreSQL và phân quyền. Xem [spec B6](docs/superpowers/specs/B6-comment.md)
và [plan/evidence B6](docs/superpowers/plans/B6-comment.md). Chưa thay thế Nam review,
CI hoặc nghiệm thu staging/F6.

## Chạy local

Yêu cầu: Node.js 22 (tối thiểu 22.13), npm, Git. PostgreSQL 17 qua Docker Desktop
(Linux containers) hoặc một PostgreSQL local có sẵn. Dùng cùng dòng Node 22 với frontend/CI.

Từ thư mục `lms-backend`, chạy trong PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d --wait
npm run db:migrate
npm run db:check
npm run dev
```

Chỉ copy `.env` lần đầu; nếu đã có file, sửa cấu hình hiện tại để giữ thông tin cá nhân.
Backend mặc định tại `http://localhost:3000`. `.env` được Git bỏ qua.
Trước lần khởi động B1 đầu tiên, tạo khóa bằng lệnh dưới rồi đặt kết quả vào `JWT_SECRET`
trong `.env` (không commit khóa):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Nếu không dùng Docker, tạo database `lms` và user trên PostgreSQL đang chạy,
cập nhật `DATABASE_URL` rồi chạy `npm run db:check`. Không cần Docker để build/test
khung; test app dùng database giả lập, kiểm tra DB thật chạy riêng.

Trong terminal khác, kiểm tra:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:3000/api/ready
```

- `/api/health`: `200`, `{ "status": "ok", "service": "lms-backend" }` nếu API chạy.
- `/api/ready`: `200`, database `connected` nếu DB kết nối được; `503` nếu DB lỗi.
- JSON lỗi dùng `{ "error": { "code": "...", "message": "..." } }`.
  Đây là hợp đồng hạ tầng tạm thời; Nam chốt API nghiệp vụ trong D2.

## Lệnh kiểm tra

```powershell
npm run check
npm run db:check
npm run db:migrate
npm run db:test
npm run api:test
npm run api:validate
npm run build
npm start
```

`check` chạy ESLint, TypeScript, test HTTP/password/OpenAPI và build. `db:check` chạy SELECT 1.
`api:test` tạo DB local tạm, áp dụng migration/seed, kiểm thử API và response theo D2,
rồi xóa đúng DB vừa tạo; yêu cầu PostgreSQL user có quyền CREATEDB. Test tích hợp
được bỏ qua trong `npm test` thông thường và chạy thật bằng `api:test` trong CI.
`db:migrate` áp dụng SQL có phiên bản trên DATABASE_URL; `db:test` dùng DB local tạm,
không reset DB dự án. GitHub Actions kiểm tra migration, DB và smoke test API đã build
khi mở PR hoặc push lên `main`. Workflow đã được chuẩn bị local; cần push/PR để có
kết quả CI trên GitHub. Có `package-lock.json`; thành viên dùng `npm ci`.

Để có dữ liệu mẫu local: chạy `db:migrate`, đặt SEED_PASSWORD (tối thiểu 12 ký tự)
trong `.env`, rồi `npm run db:seed`. Seed giữ dòng và mật khẩu cũ khi chạy lại;
chỉ chạy local. Mã tài khoản ADMIN001/GV001/GV002/SV001/SV002/SV003 đăng nhập bằng
mật khẩu đã dùng khi tạo seed (đổi SEED_PASSWORD không đổi mật khẩu tài khoản cũ).
File metadata fixture chưa có object S3 thật.
Xem [hướng dẫn migration/seed](database/migrations/README.md).

## B1 và contract D2

Nguồn duy nhất: [docs/openapi.json](docs/openapi.json), lấy từ nhánh
`docs/api-specification`, commit `532f9832d6384b95cca4504d36cfae4bff2a5390`.
Giữ các phần mở rộng JWT/mật khẩu của B1, hợp nhất thay đổi nghiệp vụ D2 mới nhất
và thêm API sửa điểm không có bài nộp: tổng 48 operation trong contract.
API thật hiện có B1, B3 assignment/submission và các route chấm/công bố/lịch sử;
ghi danh mới hoặc kích hoạt lại sau công bố cũng tạo kết quả 0 Published còn thiếu
trong cùng transaction. API không trả thông tin người công bố toàn bài.
Upload/download S3, tài liệu và bulk enrollment đã triển khai trong B1/B2.
Thông báo B5 đã có inbox SV, đánh dấu đã đọc, sự kiện giao bài/công bố điểm và nhắc
deadline trong 24 giờ; B6 Comment đã có API như bên dưới, còn announcement dành
cho module tiếp theo. Upload/download cần cấu hình
private bucket; thiếu cấu hình hoặc storage lỗi trả `503 STORAGE_UNAVAILABLE`.
JSON dùng camelCase; danh sách trả `{ items, page: { nextCursor } }`, query
`limit` (1–100, mặc định 20) và `cursor` từ trang trước. Không dùng offset/page number.

- Swagger UI local: `http://localhost:3000/api/docs/`.
- Contract: `http://localhost:3000/api/openapi.json`.
- Mock D2: `npm run api:mock` → `http://localhost:4010/api`; chỉ trả ví dụ tĩnh.
- Kiểm tra mock: `npm run api:validate` và `node scripts/mock-api.mjs --self-test`.

Login: `POST /api/auth/login` với `{ "schoolCode": "SV001", "password": "..." }`.
Response có `accessToken`, `tokenType`, `expiresIn`, `user`; access JWT hết hạn sau
15 phút, gửi bằng `Authorization: Bearer ...`. FE giữ access token trong bộ nhớ.
Refresh token ngẫu nhiên chỉ nằm trong cookie HttpOnly `lms_refresh`, DB lưu SHA-256;
session hết hạn tuyệt đối sau 7 ngày. `POST /auth/refresh` xoay cookie; FE gọi với
`credentials: 'include'` và chỉ thực hiện một refresh tại một thời điểm. Gửi lại token
đã dùng sẽ thu hồi cả phiên. Refresh/cookie logout yêu cầu Origin khớp CORS_ORIGINS
hoặc AUTH_TRUSTED_ORIGINS (origin của Swagger/API);
Postman/curl cũng phải đặt header Origin nếu dùng cookie.

`POST /auth/logout` thu hồi phiên hiện tại; đổi/reset mật khẩu và khóa tài khoản thu
hồi mọi phiên của tài khoản. JWT cũ bị chặn ngay vì mỗi request kiểm tra phiên và
trạng thái user trong DB. JWT chỉ chứa user/session IDs, không chứa password/email.

Admin tạo SV/GV bằng `POST /users` với `schoolCode`, `fullName`, `role`,
`initialPassword` (12–256 ký tự), `email` tùy chọn. Tài khoản mới có
`mustChangePassword: true`: được xem `/auth/me`, đổi mật khẩu, refresh, logout;
API nghiệp vụ trả `403 PASSWORD_CHANGE_REQUIRED` đến khi đổi mật khẩu.
`POST /auth/change-password` nhận `currentPassword`, `newPassword`, sau đó đăng nhập
lại. `POST /users/{userId}/reset-password` cấp lại mật khẩu tạm; không trả mật khẩu
trong response. API không tạo/sửa tài khoản ADMIN, không đổi schoolCode/role hoặc import CSV.

Admin cập nhật tài khoản với `PATCH /users/{userId}` (`fullName`, `email`, `isActive`),
cập nhật lớp với `PATCH /classes/{classId}`, phân công GV qua
`POST /classes/{classId}/teachers` (`teacherId`) và bỏ phân công qua DELETE đường dẫn
có teacherId. Ghi danh qua `POST /classes/{classId}/enrollments` (`studentId`).
`PATCH /classes/{classId}/enrollments/{enrollmentId}` với `isActive: false` ngừng
quyền SV vào lớp nhưng giữ bài nộp/điểm; GV được phân công vẫn xem roster/lịch sử.
Ghi danh lại tái sử dụng enrollment ID cũ. Không có hard-delete user/lớp/enrollment.

Migration `0002_b1_auth.sql` thêm `users.must_change_password`, `auth_sessions`
và `auth_refresh_tokens`; `0003_client_rules.sql` bổ sung nghiệp vụ điểm/lớp;
`0004_b3_assignments_submissions.sql` bổ sung precision, lifecycle và giới hạn file;
`0007_b5_notifications.sql` thêm index cursor cho inbox.
Không migration nào sửa lịch sử đã áp dụng. ERD hiện có 16 bảng nghiệp vụ và 2 bảng auth.
Module sau dùng lại `createAuth().authenticate`,
`requireChangedPassword`, `requireClassAccess` trong `src/modules/b1/auth.ts`.

Worker reminder chạy ngay khi API listen thành công và lặp mỗi 5 phút. Điều kiện
`(0, 24h]`, eligibility và dedup theo deadline UTC dùng đồng hồ PostgreSQL; production
phải duy trì ít nhất một API instance. SIGINT/SIGTERM dừng worker trước khi đóng pool.

Handoff Bug-06/08/09: Assignment trả thêm `canSubmit`/`lockedReason` cho SV kể cả
khi chưa có submission; auto-zero có `mySubmissionStatus: "GRADED"`. PublishedGrade
trả riêng `gradedBy` và `publishedBy`. Notification mới snapshot tên lớp, tên bài và
deadline giờ Việt Nam; NotificationPage trả tổng `unreadCount` toàn inbox. FE vẫn cần
ẩn nút/dịch lỗi, đánh số lịch sử theo lần công bố và render badge menu.

CI của D2 thất bại ở ESLint: thiếu khai báo Node globals trong file mock và một biến
không dùng. Bản nhập vào B1 đã sửa bằng import Node rõ ràng và bỏ biến đó. Chưa push
thay đổi lên nhánh D2 hoặc merge PR D2; kết quả trên GitHub của PR đó không tự thay đổi.

Kiểm tra local ngày 14/10/2026: `npm run check` đạt (11 test); API B1 đạt 21 test
với response kiểm tra theo JSON Schema D2; migration/seed đạt 19 kiểm tra. Smoke test
`dist/server.js` đạt health, readiness, Swagger UI, OpenAPI JSON, đăng nhập JWT và
`auth/me`. Lần đầu Docker Desktop crash nên kiểm tra dùng cluster PostgreSQL 17.4
riêng, đã dừng sau đó. Docker đã chạy lại; migration `0002` đã áp dụng vào DB LMS
ở cổng 15432, dữ liệu cũ được giữ nguyên. Bộ test API/database đã đạt trên PostgreSQL
Docker; login, refresh và logout từ origin Swagger local cũng đã kiểm tra thành công.
CP1, Nam review, frontend integration và kiểm thử staging vẫn cần hoàn tất trước
khi đánh dấu B1 Done. Chưa có kết quả GitHub CI cho các thay đổi local này.

## B6 Comment và bàn giao F6

- GET/POST `/api/assignments/{assignmentId}/comments`: thảo luận của GV được phân
  công và SV ghi danh active trong lớp.
- GET/POST `/api/submissions/{submissionId}/comments`: chỉ chủ bài nộp còn ghi danh
  active và GV được phân công; SV khác cùng lớp không được xem/gửi comment bài của nhau.
- Cần Bearer token hợp lệ và đã đổi mật khẩu tạm. ADMIN không tham gia comment (403);
  target không tồn tại hoặc ngoài quyền truy cập trả 404.
- POST `{ "body": "Nội dung câu hỏi" }` trả 201; body trim và không được rỗng, không
  nhận authorId/target/reply từ client. Nội dung là plain text, FE không dùng innerHTML.
- GET hỗ trợ `limit` 1..100 (mặc định 20), `cursor`; response `{ items, page: { nextCursor } }`.
  Sắp theo UUID tăng dần như các module hiện tại, không bảo đảm thứ tự thời gian.
  Đổi target phải reset cursor; sau POST nên tải lại trang đầu để không bỏ sót UUID mới.
- Comment vẫn hoạt động sau deadline/chấm/công bố; response chỉ chứa comment và danh
  tính hiển thị của tác giả, không kèm grade, feedback Draft hay email.
- Chạy B6 với database test local: `node node_modules/tsx/dist/cli.mjs scripts/test-api.ts --comments`.
  Runner tạo/migrate/seed/xóa DB tạm; không dùng DB LMS để chứa fixture test.

Điểm cần Nam/Kha xác nhận trước merge: OpenAPI còn đánh dấu Q09 cho submission
visibility, trong khi kế hoạch tuần 05–06 dùng Q09 cho nhắc deadline. Implementation
giữ thảo luận bài nộp riêng tư theo summary hiện có trong contract. Bàn giao staging:
deploy commit đã review theo cấu hình hiện có (không cần migration mới), cho Khang thử
hai GV/SV cùng lớp, SV khác chủ bài và SV ngoài lớp; ghi kết quả vào issue B6 trước đóng.
Repo hiện chỉ có workflow CI, chưa có cấu hình hoặc URL deploy staging đã xác nhận.

## Thay đổi nghiệp vụ 17/10 và bàn giao frontend

- **L20:** tạo lớp cần `courseCode`, `code`, `name`, `term`; `description` tùy chọn,
  PATCH nhận `null` để xóa mô tả. Duy nhất theo `(courseCode, code, term)`.
  GET `/classes` hỗ trợ `term`, `search` theo mã lớp/học phần/tên; GET `/users`
  hỗ trợ `search` theo mã trường/tên, cùng cursor/limit.
- **L05 còn mở:** B3 không nhận hoặc trả `note`. Metadata file phải ở trạng thái
  PENDING, thuộc người gọi và chưa gắn tài nguyên; chưa có upload S3 thật.
- GV được tạo/sửa/xem/liệt kê bài tập; SV/GV xem danh sách theo lớp. Response danh
  sách có số đã nộp/sĩ số cho GV và trạng thái bài của chính SV.
- Lần nộp đầu sau deadline vẫn được nhận và đánh Late. Version tiếp theo chỉ được
  nhận đến deadline hiện tại; gia hạn mở lại nếu chưa có Grade. Version, file links,
  deadline snapshot và PENDING → ATTACHED commit trong cùng transaction.
- Có grade Draft hoặc Published thì khóa nộp lại (`409 GRADE_LOCKS_SUBMISSION`).
  GET `my-submission` trả `canSubmit`, `lockedReason`; không chứa điểm/feedback Draft.
- GV dùng GET/PUT `/submissions/{submissionId}/grade`. Lần chấm đầu dùng version
  mới nhất; sửa grade dùng version ghi trong grade. Dữ liệu cũ từng chấm v1 rồi
  nộp v2 vẫn giữ v1, sửa/công bố được mà không viết lại lịch sử.
- POST `/assignments/{assignmentId}/grades/publish` công bố cả bài trong transaction.
  Có bài đã nộp chưa chấm thì trả `409 UNGRADED_SUBMISSIONS` kèm danh sách chặn,
  không công bố một phần. Thành công: SV/tài khoản active chưa nộp được 0, source
  `AUTO_ZERO_NO_SUBMISSION`, `submissionId`/`gradedVersionNumber` là null. Công bố
  đóng nộp bài và gọi lại không tạo trùng kết quả/lịch sử/thông báo của cùng cohort.
  Ghi danh mới hoặc kích hoạt lại sau đó thêm kết quả 0 Published còn thiếu atomically,
  giữ nguyên Grade/history đã có, không tạo submission/version giả và không mở khóa nộp.
  Kích hoạt lại tài khoản STUDENT cũng backfill kết quả cho mọi enrollment đang active
  và assignment đã Published trong cùng transaction; Grade/history cũ được giữ nguyên.
  `assignments.results_published_by` lưu người công bố trong DB, không xuất hiện trong API.
- **L04:** sửa điểm Published giữ Published, SV thấy ngay; trigger lưu snapshot
  score/feedback/trạng thái/nguồn/người/giờ và version đã chấm trong `grade_history`.
  Lịch sử bất biến, không UPDATE/DELETE. SV chỉ nhận các snapshot Published.
- **L14:** SV đọc GET `/assignments/{assignmentId}/my-result`, không lookup theo
  submission. GET cùng đường dẫn thêm `/history` xem lịch sử công bố; GV xem
  `/assignments/{assignmentId}/grades/{studentId}/history` gồm cả Draft.
  GV sửa điểm 0 chưa nộp qua PUT `/assignments/{assignmentId}/grades/{studentId}`
  (`score`, `feedback`): source hiện tại thành MANUAL, vẫn Published, không tạo bài
  nộp giả; lịch sử giữ nguồn tự gán 0 ban đầu và không mở lại nộp bài.

Khang/Cát cần tích hợp vào UI nghiệp vụ (repo frontend hiện mới có khung): hiển thị
0 kèm “Không nộp” khi source tự động; source MANUAL kèm `submissionId: null` vẫn
cho biết không có bài nộp; tách “chưa chấm” khỏi điểm 0; ẩn nút nộp khi bị khóa;
thêm lịch sử sửa điểm, mã học phần/mô tả lớp. Mock tĩnh hỗ trợ
schema ghép của danh sách bài nộp GV; dùng `X-Mock-Status: 409` để thử lỗi chặn công bố.
Mock không mô phỏng auth, transaction hay lưu trạng thái. Deadline, độ chính xác
điểm và kết quả tự động khi ghi danh sau công bố đã chốt ngày 24/10/2026. Backend
đã triển khai quy tắc ghi danh này; UI vẫn cần nghiệm thu.

Kiểm tra local 17/10/2026: lint, TypeScript, build và 11 test nền đạt; `api:test`
chạy riêng 21 test B1 + 10 test nghiệp vụ mới, có đối chiếu JSON Schema D2;
`db:test` đạt 19 kiểm tra. Mock validate/self-test và parser OpenAPI đạt.
Đã sao lưu DB LMS Docker local trước khi áp dụng 0003, đối chiếu digest cho thấy
điểm/lớp và số lượng dữ liệu cũ được giữ nguyên; thêm 2 snapshot cho 2 grade cũ.
Smoke API thật đạt health/readiness/Swagger, JWT login/logout, grade GV, bảo vệ Draft
và lịch sử Published của SV. Chưa commit/push, chưa có kết quả CI hoặc staging cho
các thay đổi này; frontend nghiệp vụ còn cần nhóm tích hợp theo phần bàn giao trên.

## Cấu trúc

```text
src/
  app.ts                # Tạo Express app; không tự listen, dễ test
  server.ts             # Khởi động và tắt server/DB pool
  config/env.ts         # Đọc và kiểm tra cấu hình
  database/pool.ts      # PostgreSQL connection pool
  modules/              # Module nghiệp vụ theo D1/D2
database/migrations/    # Migration SQL có phiên bản, D1 nháp trước CP1
scripts/check-database.ts
scripts/migrate.ts      # Runner pg: transaction, checksum, advisory lock
scripts/seed.ts         # Dữ liệu mẫu chỉ cho local
scripts/test-database.ts # Kiểm thử trên DB tạm
tests/app.test.ts
docs/                   # Quyết định kỹ thuật, checklist và câu hỏi kickoff
```

## Biến môi trường

| Biến | Mục đích |
| --- | --- |
| `HOST` | Local: `127.0.0.1`; staging/container thường cần `0.0.0.0` |
| `PORT` | Cổng API, mặc định 3000 |
| `CORS_ORIGINS` | Danh sách origin FE chính xác, ngăn cách bằng dấu phẩy, không có path/dấu `/` cuối |
| `DATABASE_URL` | URL PostgreSQL; chỉ cấu hình ở backend |
| `DATABASE_SSL` | `false` cho Docker local; `true` nếu nhà cung cấp yêu cầu TLS với chứng chỉ hợp lệ |
| `CLASS_COURSE_MAPPING` | Chỉ cho migration 0003 khi có lớp cũ không phải fixture: JSON class UUID → mã học phần thực tế; thiếu mapping thì rollback, không tự đoán mã |
| `POSTGRES_*` | Cấu hình Docker local; `POSTGRES_PORT` cần khớp cổng trong `DATABASE_URL` |
| `SEED_PASSWORD` | Mật khẩu local của tài khoản mới tạo qua db:seed; không ghi vào Git |
| `JWT_SECRET` | Khóa ngẫu nhiên ít nhất 32 byte; bắt buộc khi khởi động API B1 |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Mặc định `lms-backend` / `lms-frontend`; JWT xác minh cả hai |
| `REFRESH_COOKIE_SECURE` | Local HTTP: false; production luôn Secure, cần HTTPS |
| `REFRESH_COOKIE_SAME_SITE` | Mặc định lax; none cần Secure và HTTPS. FE/BE khác site có thể bị trình duyệt chặn cookie; ưu tiên cùng site qua reverse proxy |
| `AUTH_TRUSTED_ORIGINS` | Origin bổ sung cho login/refresh/logout từ Swagger/API, không mở thêm CORS. Dev mặc định localhost/127.0.0.1 trên PORT; production cần khai báo origin HTTPS của API nếu dùng Swagger |

Không đưa password/token/`.env` vào PR. CORS chỉ kiểm soát trình duyệt; endpoint nghiệp
vụ còn phải có auth, kiểm tra role và quyền trong lớp ở B1/B3/B4. Frontend không được
nhận điểm/feedback Draft. Không dùng `rejectUnauthorized: false` để bỏ qua kiểm tra TLS.

## Vấn đề thường gặp

- Docker báo không kết nối engine: mở Docker Desktop, chờ Linux engine chạy; dùng
  `docker version`, `docker compose ps` để kiểm tra.
- DB local dùng cổng host 15432 (cổng trong container vẫn 5432). Nếu bị chiếm,
  đổi đồng thời `POSTGRES_PORT` và `DATABASE_URL`.
- `/health` đạt, `/ready` trả 503: kiểm tra DB và `.env`, chạy `npm run db:check`.
- FE gọi API lỗi CORS: kiểm tra origin FE, cổng và `CORS_ORIGINS`; khởi động lại BE sau khi sửa `.env`.
- Đổi user/password trong `.env` sau khi volume DB đã được tạo không tự đổi user trong DB.
  Sửa user bằng SQL hoặc chọn một volume local mới; giữ dữ liệu cũ nếu còn cần.
- `npm ci` lỗi engine: kiểm tra `node --version`, chuyển sang Node 22 >=22.13.

Dừng DB bằng `docker compose stop`; tiếp tục bằng `docker compose up -d --wait`.

## Tài liệu tiếp theo

- [Quyết định kỹ thuật](docs/superpowers/specs/S1-moi-truong.md)
- [Checklist chuẩn bị và S1](docs/superpowers/plans/S1-moi-truong.md)
- [Câu hỏi kickoff/CP1/CP2](docs/superpowers/plans/S1-cau-hoi.md)
- [D1: thiết kế database nháp](docs/superpowers/specs/D1-database.md)
- ERD: [PlantUML](database/diagrams/lms-erd.puml) · [Mermaid](database/diagrams/lms-erd.mmd) · [SVG](database/diagrams/lms-erd.svg) · [chú thích](docs/superpowers/specs/D1-erd.md)
- [D1: quyết định cần chốt](docs/superpowers/specs/D1-quyet-dinh.md)
- [D1: checklist và bàn giao](docs/superpowers/plans/D1-database.md)
- [D1: kết quả kiểm tra](docs/superpowers/plans/D1-kiem-tra.md)
- [Hướng dẫn migration/seed](database/migrations/README.md)
- [Hướng dẫn chia module](src/modules/README.md)
- [D2: bản review CP1 gốc và hướng dẫn mock](docs/D2-review.md)

Branch: `S1-mo-ta-ngan`; commit: `[S1] ...`; PR: `Closes #<issue>`.
Chỉ đóng S1 khi staging chạy, FE gọi BE và cả nhóm chạy local được theo README.
