# D1/B1/B2/F2 · Thiết kế hoàn thiện tuần 02

**Owner:** Long — Tech Lead / Backend.
**Activities:** D1, B1, B2, F2; tuần 19–25/10/2026.
**Status:** Ready for PR; verified locally, pending CI, team review and staging acceptance.
**Implementation plan:** [Long Week 02 Completion Implementation Plan](../plans/D1-B1-B2-F2-tuan-02.md).

## Intent

Hoàn thiện phần còn thiếu trong công việc tuần 02 của Long: kiểm tra sửa DB theo
CP1, bổ sung ghi danh hàng loạt B1, triển khai tài liệu/upload/download B2 và tích
hợp F2 hiện có với API thật. Giữ hợp đồng dùng chung để Nam review backend,
Khang review frontend và Cát chạy T1b trên cùng một bản thiết kế.

Spec này là đầu mối thiết kế của thay đổi; plan liên kết phía trên lưu checklist,
kết quả kiểm tra và phần còn lại. Không duy trì bản bàn giao hoặc báo cáo tiến độ
trùng lặp ở thư mục docs gốc.

## Current state

### Sources and precedence

| Nguồn | Vai trò |
| --- | --- |
| Kế hoạch tuần 02, trang 4 — Long | Phạm vi D1/B1/B2/F2, hạn, người nhận bàn giao và DoD |
| [D1-quyet-dinh.md](D1-quyet-dinh.md) | Quyết định Q05–Q08 đã ghi nhận ngày 24/10/2026 |
| [openapi.json](../../openapi.json) | Nguồn hợp đồng API dùng chung cho BE, FE và QA |
| [B3 completion design](2026-10-24-b3-client-log-completion-design.md) | Hành vi B3/B4 và backfill kết quả sau công bố cần giữ nguyên |

PDF phân công được lưu ở workspace ngoài Git; không phải phụ thuộc để chạy code.
Không suy diễn tài liệu phân công thành lệnh sửa Tracker, ghi Timesheet hoặc
gửi tin nhắn nhóm. Thay đổi nghiệp vụ cần truy vết về quyết định của nhóm;
kết quả local không xác nhận thay cho CP1, staging hoặc review.

Hai điểm khác nhau giữa kế hoạch cũ và baseline hiện tại:

- Kế hoạch gọi phần sửa CP1 là migration 0002; repo đã dùng 0002 cho auth và
  0003 cho L04/L14/L20. Giữ nguyên các migration đã có, không đổi số lại.
- Q2 trong PDF cho nộp lại sau hạn; quyết định Q05–Q08 ngày 24/10 và OpenAPI hiện
  tại khóa lần nộp tiếp theo sau deadline, chỉ mở khi gia hạn. Công việc này
  giữ baseline mới và không sửa ngược B3.

### Baseline before this change

| Hoạt động | Đã có | Khoảng trống |
| --- | --- | --- |
| D1 | Mã học phần/mô tả/unique lớp L20; grade không có submission và source L14; grade_history L04; ERD | Giới hạn file material của Q08 chưa có constraint riêng |
| B1 | JWT/refresh, tài khoản/lớp, phân công GV, ghi danh đơn, lọc học kỳ, backfill Published | Bulk enrollment trong OpenAPI chưa có implementation |
| B2 | Bảng materials/files/links, lifecycle file và OpenAPI | Chưa có API tài liệu, upload/download object và cleanup |
| F2 | Màn hình đã có trên origin/F2-noi-dung-mon-hoc, frontend PR #7 dựa trên F3 | Cấu hình mock, auth chưa theo backend thật, picker chưa đủ Q08 |

Backend baseline là develop `f652a04`; frontend baseline là
origin/F2-noi-dung-mon-hoc `340e499`. B3 đã nằm trong backend develop qua PR #7.

Cập nhật tích hợp 25/10: frontend đã fast-forward tới `origin/develop` `a8b37de`
(merge PR #8/F1). Nhánh F2 của Long và develop local cùng chứa baseline mới;
các commit F2/F3 nền đã được đưa vào develop qua lần merge này.

## Goals

1. Giữ các sửa D1/B1 đã có và chứng minh regression bằng PostgreSQL integration tests.
2. Ghi danh 1–500 dòng theo contract, trả kết quả từng dòng và backfill Published
   zero trong transaction khi ghi danh mới/kích hoạt lại.
3. GV quản lý tài liệu của lớp được phân công; SV đang ghi danh xem và tải tài liệu.
4. File tuân thủ Q08, lưu trong private S3-compatible storage; download kiểm tra
   quyền theo tài nguyên cha, không chỉ dựa vào UUID.
5. F2 dùng API thật, khôi phục phiên bằng HttpOnly cookie và kiểm tra giới hạn file.
6. Có tiêu chí nghiệm thu và bằng chứng local rõ ràng; phần staging/review còn mở
   được giữ riêng trong checklist của plan.

## Non-goals

- Hoàn thiện màn quản trị F1 của Khang hoặc xây lại F2 đã có.
- Triển khai B5 notification/comment, submission note L05, unpublish hoặc hard-delete API.
- Tự chốt thông báo “Tài liệu mới” L07 khi quyết định còn mở.
- Đổi quy tắc B3/B4 đã thống nhất hoặc thay mô hình công bố điểm.
- Cấp hạ tầng cloud, sửa Tracker/Figma, ghi giờ công hoặc đóng issue thay nhóm.

## Constraints

- Node.js 22, Express 5, strict TypeScript ESM, PostgreSQL 17/pg; FE React/Vite.
- Giữ `/api`, camelCase, UUID, ISO timestamps, cursor pagination và error envelope
  `{ "error": { "code", "message" } }`.
- 0001–0005 bất biến. Thay đổi mới dùng `0006_b2_material_file_limit.sql`.
- Auth/role/membership/ownership được kiểm tra tại backend; UI chỉ hỗ trợ thao tác.
- Không đưa key/password/token vào Git, log, screenshot hoặc VITE_*.
- Không công bố Draft hay thay đổi grade/history đã có khi backfill.
- Giữ `.env` hiện có; không reset/migrate DB dự án trong các test tự động.

## Approaches considered

### 1. Viết lại frontend từ develop

Không chọn vì F2 đã có trên nhánh riêng, dựng trên F3. Viết lại làm trùng công
việc và tăng rủi ro khác UI kit/contract.

### 2. Hoàn thiện backend còn thiếu và tích hợp F2 hiện có — selected

Bổ sung bulk B1, module materials/storage B2 và migration constraint. Tiếp tục
từ F2 hiện có, chỉ sửa các phụ thuộc cần thiết để dùng API thật. Hai repo dùng
hai nhánh nhưng chung spec và checklist nghiệm thu.

### 3. Chỉ bổ sung mock tài liệu

Không chọn vì DoD B2/F2 cần API thật, lưu trạng thái và download có phân quyền.
Mock chỉ là công cụ phát triển theo OpenAPI.

## Component design

### B1: bulk enrollment

`POST /classes/{classId}/enrollments/bulk` chỉ dành cho ADMIN, nhận:

```json
{ "students": [{ "row": 1, "schoolCode": "SV001" }] }
```

Request hợp lệ có 1–500 dòng; `row` là số nguyên dương, mã tài khoản được trim
và chuẩn hóa uppercase. Payload sai cấu trúc trả 400. Kết quả mỗi dòng:

| Status | Điều kiện |
| --- | --- |
| ENROLLED | Tạo hoặc kích hoạt lại enrollment thành công |
| ALREADY_ENROLLED | Enrollment đã active, gồm dòng lặp sau một dòng thành công |
| NOT_FOUND | Mã không tồn tại hoặc tài khoản inactive |
| INVALID_ROLE | Tài khoản active nhưng không phải STUDENT |

Response giữ thứ tự input, gồm `items`, `successCount`, `failureCount`;
successCount chỉ đếm ENROLLED. Lỗi dữ liệu một dòng không chặn các dòng hợp lệ;
lỗi hệ thống làm rollback transaction.

EnrollmentService khóa lớp trước khi xử lý membership và dùng lại
AssessmentService backfill trong cùng transaction. Reactivation giữ enrollment ID;
kết quả/history hiện có được giữ nguyên. Assignment đã công bố tạo kết quả 0
Published còn thiếu với source AUTO_ZERO_NO_SUBMISSION, không tạo submission giả
và không mở lại quyền nộp.

### B2: materials API

| Operation | Actor | Hành vi |
| --- | --- | --- |
| GET `/classes/{classId}/materials` | GV/SV có quyền lớp | Danh sách theo cursor/limit |
| POST `/classes/{classId}/materials` | GV được phân công | Tạo tài liệu và gắn file atomically |
| GET `/materials/{materialId}` | GV/SV có quyền lớp | Xem nội dung và metadata file |
| PATCH `/materials/{materialId}` | GV được phân công | Sửa title/description/fileIds |
| POST `/files` | GV/SV | Upload một field multipart `file` |
| GET `/files/{fileId}/download` | GV/SV có quyền tài nguyên cha | Stream attachment riêng tư |

GV cùng lớp quản lý tài liệu ngang nhau. ADMIN không được dùng các operation
module nội dung vì x-roles chỉ định GV/SV. Thành viên ngoài lớp trả 404 để không
tiết lộ tài nguyên. SV không được ghi tài liệu.

Title sau trim dài 1–200; description nullable, tối đa 10.000 ký tự. PATCH cần ít
nhất một field; `description: null` xóa mô tả. `fileIds` khác nhau, tối đa 10.
API chấp nhận danh sách rỗng; UI hiện yêu cầu ít nhất một file để đăng tài liệu.
Cursor chứa scope theo người dùng và lớp, không được dùng lại giữa các scope.

Mutation giữ khóa membership đến commit. File mới phải thuộc người gọi,
PENDING và chưa quá 24 giờ. Gắn link và chuyển ATTACHED trong transaction;
trigger chống gắn cùng file vào nhiều tài nguyên. Khi sửa, file giữ lại không
cần upload lại; file bị bỏ chuyển DELETE_PENDING, không trở về PENDING.

### Q08: file validation and lifecycle

Nguồn allowlist là `uploadFile.x-allowed-extensions` trong OpenAPI: tài liệu,
bảng tính, slide, text/data, source, ảnh và ZIP. Giới hạn 25 MiB/file,
10 file/material; quy tắc 100 MiB/submission version của B3 được giữ nguyên.

- Chuẩn hóa đuôi cuối, đối chiếu MIME được khai báo và nội dung được nhận diện.
- Allowlist chỉ kiểm tra key khai báo trực tiếp; đuôi như `.constructor` và
  `.__proto__` bị trả 415, không lọt qua thuộc tính kế thừa của JavaScript object.
- Binary có signature tương ứng; text phải UTF-8 và không chứa binary controls.
- Legacy Office kiểm tra OLE directory, loại tài liệu và dấu hiệu storage macro;
  OOXML kiểm tra package và từ chối nội dung macro. Đây không phải dịch vụ antivirus.
- Chặn executable, system scripts, Office macro, đuôi lạ/không đuôi, `.rar`, `.7z`.
- ZIP tối đa 100 entry, 200 MiB sau giải nén, tỷ lệ 20:1; chặn encrypted entry,
  archive lồng, symlink, absolute/parent paths và đuôi cấm bên trong.
- Kiểm tra archive bằng stream, không giải nén vào filesystem hoặc thực thi file.

Multipart stream vào file tạm do server sinh tên; dọn trong finally. Runtime
không buffer toàn bộ upload trong RAM. Upload tới S3 và download từ S3 đều dùng stream.

Metadata public chỉ gồm id/originalName/mimeType/sizeBytes/createdAt; không trả
bucket, object key, provider hoặc lifecycle nội bộ. Upload hỏng giữ bản ghi có thể
cleanup; không để object thất bại mất dấu trong DB.

### Private storage, download and cleanup

ObjectStorage có `bucket`, `put`, `get`, `remove`; S3 adapter lấy cấu hình từ
environment/provider chain. Bucket được tạo trước và phải private. Backend
không tạo bucket hoặc cấp public ACL. Thiếu cấu hình/lỗi storage trả
`503 STORAGE_UNAVAILABLE`; lỗi loại file 415, quá dung lượng 413, input sai 400.

Download chỉ nhận file ATTACHED, xác minh đúng một tài nguyên cha và membership
hiện tại. Với submission file, SV chỉ được tải bài của chính mình; GV được phân
công có thể tải bài trong lớp. Enrollment ngừng hiệu lực mất quyền tải.
Response dùng application/octet-stream, Content-Disposition attachment với
filename UTF-8 và Cache-Control private/no-store.

`files:cleanup` xử lý tối đa 100 object/lượt, dùng FOR UPDATE SKIP LOCKED:

1. Chọn orphan PENDING quá 24 giờ hoặc DELETE_PENDING đến thời điểm retry.
2. Bỏ qua file còn liên kết tài nguyên.
3. Xóa object trước, sau đó metadata. Nếu storage xóa thất bại, giữ DELETE_PENDING
   và ghi delete_attempted_at; retry sau ít nhất 5 phút.

Chạy lại an toàn khi object đã mất nhưng metadata chưa được xóa. Scheduler deployment
cần gọi job định kỳ, ví dụ mỗi 15 phút; đó là điều kiện staging còn mở.

### D1: additive database constraint

Migration 0006 kiểm tra material cũ không vượt 10 attachment trước khi thêm
deferred constraint trigger `material_file_set_limits`. Nếu có vi phạm, migration
dừng để nhóm xử lý, không tự xóa dữ liệu. Insert file thứ 11 phải rollback cả link
và chuyển trạng thái file. Không thay đổi field/quan hệ ERD.

### F2: real API integration

Giữ màn lớp học/tài liệu/bài tập hiện có trên frontend F2. Base URL mặc định và
`.env.example` đổi về `http://localhost:3000/api`; mock 4010 chỉ dùng khi chọn rõ.
`.env` cũ được giữ, cần kiểm tra cấu hình khi chạy.

- API/login/download gửi `credentials: include`. Access JWT chỉ giữ trong RAM.
- Khi reload hoặc token hết hạn, các request 401 chia sẻ một lần auth/refresh,
  rồi retry một lần với bearer mới; login sai mật khẩu không tự refresh.
- Request cũ không được retry sau khi login/logout đổi phiên. Login đợi vòng
  refresh cookie đang chạy kết thúc trước khi gửi credential mới; kết quả khôi
  phục phiên cũ không được ghi đè user/token của lần đăng nhập mới.
- Cookie do backend cấp HttpOnly. Sau đổi mật khẩu, các session bị thu hồi và
  người dùng đăng nhập lại; ProtectedRoute chặn nghiệp vụ khi mustChangePassword.
- Tái sử dụng trang đổi mật khẩu, ProtectedRoute, LoginPage và User type của F1
  đã merge; không giữ bản ChangePasswordPage trùng do Long thêm trước đó. Giữ
  `endSession` mới của F1, chỉ bổ sung khôi phục cookie session trong AuthContext
  để access token RAM tiếp tục hoạt động khi reload trang F2.
- Picker dùng allowlist Q08; chặn file rỗng hoặc >25 MiB trước upload. Form tối đa
  10 file, title 200 và description 10.000. Backend kiểm tra lại MIME/archive/quyền.
- Mỗi form giữ cache upload thành công theo File object để thử lưu lại hoặc
  tiếp tục sau upload lỗi không gửi lại file đã xong. Cache chỉ dùng trong form,
  bỏ khi File được thu gom và hết hiệu lực sau 23 giờ, trước TTL PENDING 24 giờ.

Các màn admin, menu mobile và bộ lọc lớp mới được lấy nguyên bản từ develop/F1
của Khang. Long không sửa implementation các màn này trong phần tích hợp F2.

## Verification design

| ID | Tiêu chí | Evidence |
| --- | --- | --- |
| AC-D1-01 | 0001–0005 bất biến, 0006 chạy lại no-op; dữ liệu cũ vi phạm không bị xóa ngầm | scripts/test-database.ts, migration preflight |
| AC-D1-02 | Tài liệu nhận 10 file; file thứ 11 bị chặn ở HTTP và DB, không đổi lifecycle sai | materials.integration.test.ts |
| AC-B1-01 | Bulk giới hạn/role/class đúng, kết quả từng dòng đúng thứ tự và counts | materials.integration.test.ts |
| AC-B1-02 | Ghi danh mới/reactivation sau công bố có một Published zero, giữ kết quả cũ | materials.integration.test.ts, enrollment-publication.integration.test.ts |
| AC-B2-01 | CRUD/cursor tài liệu đúng contract, role và membership | materials.integration.test.ts |
| AC-B2-02 | File owned/unexpired/PENDING, chống reuse/race và rollback | materials.integration.test.ts |
| AC-B2-03 | Đúng 25 MiB được nhận, vượt một byte bị chặn; MIME/ZIP/Office theo Q08 | file-policy.test.ts, materials.integration.test.ts |
| AC-B2-04 | Download không lộ bài bạn cùng lớp hoặc file ngoài lớp; ngừng membership mất quyền | materials.integration.test.ts |
| AC-B2-05 | Cleanup bỏ linked file, retry deletion lỗi; storage outage trả lỗi rõ | materials.integration.test.ts |
| AC-B2-06 | S3 SDK PUT/GET/DELETE giữ nguyên bytes và dùng signed requests | storage.test.ts — HTTP fixture cục bộ |
| AC-F2-01 | Auth refresh chia sẻ, token RAM; upload/download và lỗi đúng | apiClient.test.ts, assignments.test.ts |
| AC-F2-02 | GV tạo/sửa/reload; SV tải đúng file; đổi mật khẩu lần đầu; mobile không tràn | Browser smoke local, evidence trong plan |
| AC-TEAM-01 | BE/FE chạy trên staging với bucket private và scheduler thật | Chưa nghiệm thu |
| AC-TEAM-02 | Nam review BE; Khang review F2; Cát chạy T1b | Chưa nghiệm thu |

Run backend check, api:test, db:test, api:validate, mock self-test và frontend check.
`npm test` thường skip integration khi không có B1_TEST_DATABASE_URL; phải chạy
api:test trên PostgreSQL để xác nhận phần tích hợp. Các test dùng DB tạm riêng.

## Documentation and migration policy

### VanDe regression fixes — 25/10/2026

Nguồn: [VanDe](https://docs.google.com/spreadsheets/d/1HvKlMRfsfEOSjFBfbY3rnPW469DV5TsXS8WyPOakbAM/edit?gid=1652459086#gid=1652459086),
Bug-01, Fail-01, Fail-03 và Fail-04. Chỉ sửa phần B1/B2 của Long; không cập nhật sheet.

- **Fail-01:** đã có bốn endpoint tài liệu trong nhánh PR #10: `GET/POST
  /api/classes/:id/materials`, `GET/PATCH /api/materials/:id`. Đã gắn router vào app;
  test HTTP kiểm tra tạo/list/cursor/đọc/sửa, contract, quyền và attachment. Cần chạy
  backend từ nhánh/commit PR #10 hoặc develop sau khi PR merge; bản develop chưa có
  B2 không cung cấp các endpoint này. Không thêm endpoint ngoài D2 để xử lý ghi nhận cũ.

- **Fail-03:** DOCX/XLSX/PPTX chỉ chứa XML/rels/VML hoặc ảnh PNG/JPEG/GIF/WebP/BMP/TIFF
  có magic bytes khớp. Chặn embeddings/OLE/ActiveX/macros/externalLinks, binary entry,
  executable, DTD và relationship ngoài. XML được parse theo stream bằng SAX, decode
  character reference trước kiểm tra; attribute namespace/case khác không che được
  `TargetMode`, `Target`, `Type`. Giữ giới hạn archive cũ. Package hợp lệ vẫn được nhận;
  Office có nội dung nhúng/active hoặc part ngoài allowlist trả 415.
- **Fail-04:** `POST /files` có giới hạn mặc định 20 lượt/60 giây/user, tính cả upload
  lỗi validation, dùng ID người dùng qua các session. Quá giới hạn trả 429
  `UPLOAD_RATE_LIMITED` và `Retry-After`. Bộ đếm rate ở MemoryStore của từng process;
  nếu scale nhiều process cần shared rate store. Quota DB dùng chung: tối đa 20 file
  và 250 MiB tổng `PENDING` + `DELETE_PENDING`/user. Khóa user row, đếm và reserve
  trong một transaction trước ghi object; request đồng thời qua nhiều app không
  vượt quota. Vượt quota trả 429 `UPLOAD_QUOTA_EXCEEDED`, không tạo row/object mới.
  Attach file giải phóng quota; backlog xóa lỗi giữ quota đến khi cleanup thành công.
  Cấu hình bốn biến `UPLOAD_*` trong `.env.example`, chỉ nhận số nguyên dương;
  không cần migration mới.
- **Bug-01:** [ảnh báo lỗi](https://drive.google.com/file/d/1olP0s7gSQN7dVMpvcWhmw2FFPq9GX7R1/view)
  cho thấy seed `Lớp Demo A/B` đúng nhưng tên lớp `CO2013/L01` đã chứa `?` trong JSON.
  Chưa có request gốc để kết luận client nào làm mất dấu. API kiểm tra byte UTF-8
  trước parse JSON, tránh decoder âm thầm thay byte lỗi bằng U+FFFD: trả 400
  `INVALID_ENCODING`; charset JSON khác UTF-8 trả 415 `UNSUPPORTED_CHARSET`.
  Regression kiểm tra tạo/sửa/đọc/tìm lớp, mô tả và tên người dùng có dấu qua HTTP/DB.
  Chuỗi ASCII đã chứa `?` là dữ liệu hợp lệ, không thể suy ngược tên tiếng Việt;
  người nhập cần sửa lại tên đúng qua API/form sau khi kiểm tra bản gốc.

Đề xuất Nam bổ sung các mã lỗi 429/encoding vào D2/OpenAPI; không sửa file D2.

OpenAPI là contract duy nhất và thuộc task D2 của Nam; file được giữ nguyên.
Long bàn giao đề xuất mô tả bulk counts/status, fileIds maxItems/uniqueItems,
text lengths và lỗi storage 403/503 để Nam review/cập nhật. Các ràng buộc và mã
lỗi này đã có trong implementation B1/B2, nhưng chưa được ghi bổ sung vào contract.
Không thêm field nghiệp vụ, endpoint hard-delete hoặc API notification ngoài scope.

Các mục nhóm cần ghi MaTran_NhatKy: L19/B1 bulk; Q08/B2 upload/download/lifecycle;
Q08/D1 material file constraint; đề xuất Q08/D2 validation và error responses cho Nam. Checklist
ghi Tracker/review/deployment nằm trong plan, chưa được tự đánh dấu đã đạt.

## Branch and delivery

- Backend: `B2-noi-dung-upload-tuan-02`, từ develop `f652a04`.
- Frontend: `F2-tich-hop-api-that`, ban đầu từ F2 `340e499`, đã cập nhật develop
  `a8b37de`. develop local cũng đã fast-forward tới cùng commit.
- F2/F3 nền đã có trong develop qua PR #8; chỉ review các thay đổi tích hợp local
  của Long so với develop, không đưa lại các commit nền như một tính năng mới.
- Đề xuất tách commit theo mã D1/B1/B2/F2 hoặc nhóm thay đổi liên quan để review.
- Hai nhánh tính năng được chuẩn bị để Long mở PR hướng `develop`; không merge
  thay nhóm. CI, reviewer và staging được nghiệm thu trên PR riêng.

## Success criteria

Các tiêu chí local trong bảng verification phải có evidence và không làm hỏng
B1/B3/B4 hiện có. Để đóng task theo DoD của kế hoạch còn cần migration/API/F2
trên staging, bucket/scheduler thật, T1b và review đúng người. Local verified
không đồng nghĩa với team acceptance hoặc hoàn thành đúng hạn lịch sử.
