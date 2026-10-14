# D1 · Thiết kế database nháp

Ngày chuẩn bị: 11/10/2026 · Long phụ trách · **Draft, chưa được duyệt tại CP1**.

Đây là đầu vào để Long/Nam đối chiếu DB với API D2. Migration `0001` và seed đã được
triển khai, kiểm tra và áp dụng trên PostgreSQL local; schema vẫn là bản nháp trước
CP1. Prototype R1 dự kiến ngày 12/10 và OpenAPI D2 chưa có trong repo tại thời điểm
soạn; cần đối chiếu hai đầu vào này trước khi duyệt.

## Căn cứ và mức độ chắc chắn

| Nguồn | Nội dung dùng trong thiết kế |
| --- | --- |
| [LMS Project.pdf](../../LMS%20Project.pdf), trang 2–3 | Client Log #1–12: tài khoản cấp sẵn, nhiều GV/lớp, lịch sử nộp, nhiều file, điểm công bố, thông báo và comment |
| [LMS Project.pdf](../../LMS%20Project.pdf), trang 9–10, 16 | Phạm vi Task 1.4 và DB Schema: chín thực thể chính, ERD + migration, 3NF và khóa ngoại |
| [Full task từng người.pdf](../../Full%20task%20t%E1%BB%ABng%20ng%C6%B0%E1%BB%9Di.pdf), trang 7, 10–11 | Long làm D1 ngày 14–15/10; Nam làm D2, thống nhất tên thực thể; B3 dùng dữ liệu mẫu |
| [Kế hoạch tuần 01](../../K%E1%BA%BF%20ho%E1%BA%A1ch%20tu%E1%BA%A7n%2001%20%C2%B7%2012-18%2010%20%C2%B7%20LMS%20Nh%C3%B3m%202.pdf), trang 4–5 | Bàn giao DB cho Nam/Khang; DB, API và UI hội tụ tại CP1 ngày 15/10 |

- **Đã xác nhận:** PostgreSQL; Long chọn UUID, migration SQL dùng pg và mã trường
  đăng nhập (email liên hệ); ba role Admin/GV/SV; Admin cấp tài khoản, tạo lớp,
  phân công và ghi danh; một lớp nhiều GV có quyền ngang nhau; nộp lại trước
  deadline; cho nộp trễ; lưu lịch sử nộp; điểm/feedback chỉ hiển thị sau Publish.
- **Đề xuất kỹ thuật:** tên bảng/cột, kiểu khóa, cấu trúc bảng phụ, ràng buộc và index
  bên dưới. Có thể sửa khi đối chiếu D2.
- **Chưa chốt:** phần còn lại Q01 và Q04–Q10 trong [D1-decisions.md](D1-decisions.md).
  Bản nháp không tự bổ sung quy tắc nghiệp vụ đã được khách hàng duyệt.

## 1. Bảng thực thể — dữ liệu — quan hệ — câu hỏi

Chín thực thể trong kế hoạch được triển khai thành **15 bảng đề xuất**. Các bảng
phụ tách quan hệ nhiều–nhiều, phiên bản và file; không phải thêm module mới.

| Thực thể / bảng | Dữ liệu cần lưu | Quan hệ chính | Điểm phải chốt |
| --- | --- | --- | --- |
| User → `users` | Mã trường, tên, email, hash mật khẩu, role, trạng thái hoạt động | GV được phân công; SV được ghi danh; người tạo/chấm/comment | Q01, Q04: trường đăng nhập, một hay nhiều role |
| Class → `classes` | Mã lớp, tên lớp, học kỳ, người tạo, thời gian | Nhiều GV, nhiều SV, tài liệu, bài tập | Q04, Q10: mã lớp theo kỳ, lưu trữ/xóa |
| Phân công → `class_teachers` | Lớp, GV, người phân công, thời gian | Bảng nối `classes`–`users` | Chỉ role TEACHER; mọi GV trong lớp quyền ngang nhau |
| Enrollment → `enrollments` | Lớp, SV, trạng thái ghi danh, thời gian | Bảng nối lớp–SV; tham chiếu khi nộp bài | Q10: thôi học/ghi danh lại, quyền xem dữ liệu cũ |
| Material → `materials` | Lớp, tiêu đề, mô tả, người tạo, thời gian | Thuộc lớp; nhiều file qua `material_files` | Q08: số lượng/loại file; Q10: xóa tài liệu |
| Assignment → `assignments` | Lớp, tiêu đề, mô tả, deadline, điểm tối đa, người tạo | Nhiều bài nộp; file đề; thông báo | Q05, Q07: thang điểm và sửa deadline |
| Submission → `submissions` | Bài tập, ghi danh của SV, thời gian tạo | Một hồ sơ/SV/bài; nhiều phiên bản; một kết quả điểm hiện tại | Q06: xử lý nộp lại sau chấm/công bố |
| Phiên bản → `submission_versions` | Hồ sơ bài nộp, số phiên bản, giờ nộp, deadline lúc nộp | Nhiều file; Grade chỉ rõ phiên bản đã chấm | Q06–Q07: Late, hoàn tất upload, giữ lịch sử |
| Grade → `grades` | Hồ sơ bài nộp, phiên bản được chấm, điểm, feedback, Draft/Published, GV chấm/công bố | Tối đa một kết quả hiện tại cho một hồ sơ bài nộp | Q05–Q06: sửa/công bố/thu hồi và nộp lại |
| Notification → `notifications` | Người nhận, loại sự kiện, nội dung, bài tập liên quan, đã đọc, khóa chống trùng | Một dòng cho một người nhận | Q09: nhắc deadline và nội dung thông báo |
| Comment → `comments` | Người viết, nội dung, đối tượng được bình luận, thời gian | Nhắm bài tập hoặc hồ sơ bài nộp | Q09: ai xem comment trên kết quả/bài nộp |
| File → `files` | Nơi lưu, object key, tên gốc, MIME, dung lượng, người upload | Metadata dùng bởi bảng gắn file | Q08: giới hạn file và vòng đời file |
| `material_files` | ID tài liệu, ID file | Một tài liệu nhiều file | Không lưu danh sách ID trong một cột |
| `assignment_files` | ID bài tập, ID file | Một bài tập nhiều file đề | Cần xác nhận UI/spec có file đính kèm đề |
| `submission_files` | ID hồ sơ, số phiên bản, ID file | Một phiên bản nhiều file | File của bản cũ không bị bản mới ghi đè |

## 2. Quy ước đề xuất cho D1/D2

| Hạng mục | Đề xuất để review | Trạng thái |
| --- | --- | --- |
| Tên DB | `snake_case`, tên bảng số nhiều | Long/Nam xác nhận |
| Tên API | `camelCase`; mapper chuyển tên DB sang JSON | Nam xác nhận trong OpenAPI |
| Khóa đơn | `uuid`; DB có DEFAULT gen_random_uuid, backend cũng có thể phát sinh ID | Long đã chốt Q02 |
| Khóa nối | Khóa ghép của các ID liên quan | Theo ERD nháp |
| Phiên bản nộp | Số nguyên bắt đầu từ 1; khóa `(submission_id, version_number)` | Q06, Nam xác nhận dạng API |
| Thời gian | `timestamptz`; API ISO 8601 có offset, thống nhất xuất UTC; UI hiển thị Asia/Ho_Chi_Minh | Q07 |
| Role | `ADMIN`, `TEACHER`, `STUDENT` | Giá trị API do Nam xác nhận |
| Điểm | `numeric`; không dùng float; chưa đóng cứng thang điểm/độ chính xác | Q05 |
| Hash mật khẩu | `password_hash`, không trả qua API | Thuật toán và auth chốt trước B1 |
| Xóa dữ liệu | Ưu tiên giữ lịch sử, chặn xóa cha còn bài nộp/điểm | Q10 |
| Migration | SQL + pg, có phiên bản/checksum/transaction/lock; không tự sync schema khi khởi động | Long đã chốt Q03 |

`created_at` và `updated_at` là thời gian do backend/database quản lý, không tin giờ
do frontend gửi. Các cột tùy chọn được ghi `NULL`; những cột khác đề xuất `NOT NULL`.

## 3. Từ điển dữ liệu nháp

### `users`

- `id uuid` — PK.
- `school_code text` — UNIQUE; mã SV/GV/Admin trong bộ dữ liệu giả lập.
- `full_name text`, `email text NULL`, `password_hash text`.
- `role text` — CHECK thuộc ADMIN/TEACHER/STUDENT; một role/tài khoản là đề xuất Q04.
- `is_active boolean`; `created_at timestamptz`, `updated_at timestamptz`.
- Mã trường là tên đăng nhập đã chốt Q01; trim + uppercase và UNIQUE. Email dùng
  liên hệ, hiện tùy chọn và không UNIQUE. Không trả password_hash qua API.

### `classes`

- `id uuid` — PK; `code text`, `name text`, `term text`.
- `created_by uuid` — FK → users; `created_at`, `updated_at`.
- Đề xuất UNIQUE `(code, term)`; Admin thực hiện tạo lớp. Q04 xác nhận quy tắc mã.
- Chưa thêm bảng môn học/phòng ban do chưa có yêu cầu phải quản lý riêng.

### `class_teachers`

- `class_id uuid` — FK → classes; `teacher_id uuid` — FK → users.
- PK `(class_id, teacher_id)`; `assigned_by uuid` — FK → users; `assigned_at timestamptz`.
- Không có cột chính/phụ. FK user tồn tại không đồng nghĩa user có role TEACHER;
  trigger đã kiểm tra role và chặn đổi role khi còn membership; quyền actor vẫn ở B1.

### `enrollments`

- `id uuid` — PK; `class_id uuid` — FK → classes; `student_id uuid` — FK → users.
- UNIQUE `(class_id, student_id)`; `is_active boolean` là đề xuất cho thôi học/ghi danh lại.
- `enrolled_by uuid` — FK → users; `created_at`, `updated_at`.
- Mỗi dòng chỉ ghi danh SV, tách khỏi phân công GV. Giữ ID khi đổi trạng thái để
  bài nộp cũ còn truy vết; Q10 phải chốt quyền xem và ghi danh lại.

### `materials`

- `id uuid` — PK; `class_id uuid` — FK → classes.
- `title text`, `description text NULL`; `created_by uuid` — FK → users.
- `created_at`, `updated_at`; file nằm ở `material_files`.
- Cần kiểm tra người tạo/sửa là GV đang được phân công vào đúng lớp.

### `assignments`

- `id uuid` — PK; `class_id uuid` — FK → classes.
- `title text`, `description text NULL`, `deadline_at timestamptz`, `max_score numeric`.
- `created_by uuid` — FK → users; `created_at`, `updated_at`.
- CHECK `max_score > 0`; chưa có default thang 10 hay 100 (Q05).
- Không dùng trạng thái Draft/Published của Grade để suy ra trạng thái bài tập.
  Không thêm workflow publish bài tập khi prototype/spec chưa yêu cầu.

### `submissions`

- `id uuid` — PK; `assignment_id uuid` — FK → assignments.
- `enrollment_id uuid` — FK → enrollments; UNIQUE `(assignment_id, enrollment_id)`.
- `created_at timestamptz`.
- Một dòng đại diện hồ sơ nộp của một SV cho một bài; không phải mỗi lần nộp.
- Không lặp `student_id` hay `class_id`: suy ra qua enrollment/assignment.
- **Ràng buộc quan trọng:** lớp của enrollment phải trùng lớp của assignment.
  Hai FK riêng lẻ chưa bảo đảm điều này. Migration có trigger DB kiểm tra và chặn
  đổi lớp của cha khi đã có bài nộp; service B3 vẫn phải kiểm tra actor/quyền.

### `submission_versions`

- `submission_id uuid` — FK → submissions; `version_number integer`.
- PK `(submission_id, version_number)`; CHECK `version_number >= 1`.
- `submitted_at timestamptz`; `deadline_at_submission timestamptz` là snapshot đề xuất Q07.
- Bản hiện hành là số phiên bản lớn nhất đã hoàn tất transaction; không thêm
  `is_current` trên nhiều dòng hay con trỏ circular trong bản nháp.
- Deadline snapshot là sự kiện lịch sử tại lúc nộp, khác deadline hiện tại của bài.
  Nếu Q07 chọn luôn tính theo deadline mới, bỏ snapshot trước migration.
- Tạo phiên bản và gắn toàn bộ file trong cùng transaction; chỉ ghi bản hoàn tất.
  Khi hai yêu cầu nộp cùng lúc, khóa dòng submissions trước khi cấp số phiên bản,
  kết hợp PK để không trùng số. Không chỉ dùng `MAX + 1` mà không khóa/transaction.
- Giữ nguyên file của bản cũ. Khái niệm Late và nộp lại sau deadline chờ CP2.

### `grades`

- `submission_id uuid` — PK và FK → submissions: tối đa một kết quả hiện tại/hồ sơ.
- `graded_version_number integer`; FK ghép `(submission_id, graded_version_number)`
  → submission_versions `(submission_id, version_number)`.
- `score numeric`, `feedback text NULL`, `status text` — CHECK DRAFT/PUBLISHED.
- `graded_by uuid` — FK → users; `graded_at timestamptz`.
- `published_by uuid NULL` — FK → users; `published_at timestamptz NULL`; `updated_at`.
- CHECK score hữu hạn và không âm; trigger kiểm tra không vượt max_score của bài,
  đồng thời chặn hạ max_score dưới điểm đã có. Service vẫn kiểm tra dữ liệu/quyền;
  thang điểm và độ chính xác cần review Q05.
- Đề xuất Published bắt buộc có người và giờ công bố; Draft không có hai trường này.
  Quy tắc sửa/thu hồi điểm Published vẫn phải chốt Q05.
- Chưa có điểm thì không có dòng Grade; điểm 0 là điểm hợp lệ, không dùng để biểu thị
  chưa chấm. Không thêm lịch sử mọi lần sửa điểm vì Client Log #6 không bắt buộc.
- Grade ghi rõ phiên bản đã chấm. Không mặc định điểm của bản cũ áp dụng cho bản mới
  khi SV nộp lại; Q06 quyết định có giữ, ẩn hay reset điểm.

### `files`

- `id uuid` — PK; `storage_provider text`, `storage_container text`, `object_key text`.
- UNIQUE `(storage_provider, storage_container, object_key)`.
- `original_name text`, `mime_type text`, `size_bytes bigint` — CHECK `size_bytes > 0`.
- `uploaded_by uuid` — FK → users; `created_at timestamptz`.
- Provider dự kiến S3, chưa triển khai. Lưu metadata và object key, không lưu bytes,
  access key hay signed URL đã hết hạn trong database.
- Backend tự tạo object key duy nhất; không lấy tên gốc làm khóa để ghi đè bản cũ.
- Metadata MIME/tên do client gửi không đủ xác nhận nội dung; kiểm tra upload tại B2/B3.

### Các bảng gắn file

| Bảng | Khóa / FK | Ý nghĩa |
| --- | --- | --- |
| `material_files` | PK `(material_id, file_id)`; FK → materials và files | File đính kèm tài liệu |
| `assignment_files` | PK `(assignment_id, file_id)`; FK → assignments và files | File đề bài nếu spec/UI yêu cầu |
| `submission_files` | PK `(submission_id, version_number, file_id)`; FK ghép → submission_versions; FK file_id → files | File thuộc đúng lần nộp |

Đề xuất mỗi file upload gắn với một đối tượng nghiệp vụ; không dùng cùng object để
ghi đè/tái sử dụng giữa các phiên bản. PK/FK ở từng bảng nối không tự bảo đảm quy tắc
một file chỉ có một chủ sở hữu trên cả ba bảng; cần chốt Q08 và cơ chế service/DB.

Quy trình upload cần dọn object mồ côi nếu ghi metadata/transaction thất bại. Việc
xóa file khỏi storage không tự xảy ra khi xóa dòng DB; phải có bước xử lý rõ ràng.

### `notifications`

- `id uuid` — PK; `recipient_id uuid` — FK → users.
- `assignment_id uuid NULL` — FK → assignments.
- `kind text`: đề xuất ASSIGNMENT_CREATED/DEADLINE_REMINDER/GRADE_PUBLISHED.
- `title text`, `body text`, `read_at timestamptz NULL`, `created_at timestamptz`.
- `deduplication_key text NULL`; UNIQUE `(recipient_id, deduplication_key)` để tránh
  gửi lặp một sự kiện cho cùng người, cách tạo key sẽ do B5 chốt.
- Title/body là nội dung sự kiện tại lúc phát sinh, không phải bản sao luôn đồng bộ
  của bản ghi nghiệp vụ. Không đưa điểm/feedback Draft vào thông báo.
- Đề xuất trạng thái đọc qua read_at, không lưu thêm is_read có thể lệch nhau.

### `comments`

- `id uuid` — PK; `author_id uuid` — FK → users; `body text`; `created_at`, `updated_at`.
- `assignment_id uuid NULL` — FK → assignments.
- `submission_id uuid NULL` — FK → submissions.
- CHECK đúng một trong hai target có giá trị: comment bài tập hoặc phản hồi trên
  hồ sơ bài nộp/kết quả. Không dùng target_type + target_id không có FK.
- Đề xuất comment phẳng, chưa có thread/realtime. Quyền đọc/viết theo Q09, đặc biệt
  không cho SV khác xem thảo luận riêng của một bài nộp.
- Bản nháp chưa gắn comment vào một phiên bản cụ thể; nếu prototype yêu cầu thì
  phải bổ sung target phiên bản trước migration.

## 4. Ràng buộc và phân quyền cần phối hợp

| Quy tắc | DB có thể bảo đảm | Backend cần bảo đảm |
| --- | --- | --- |
| Một SV ghi danh một lần/lớp | UNIQUE class/student | Admin có quyền; chỉ user STUDENT; trạng thái ghi danh |
| Một GV phân công một lần/lớp | PK class/teacher | Admin có quyền; chỉ user TEACHER |
| Nộp đúng lớp | Trigger đối chiếu hai FK, đã có | Actor là SV của enrollment, active, đúng assignment |
| Lịch sử và phiên bản | PK/FK ghép, transaction | Hoàn tất upload, khóa cấp số, rule deadline/nộp lại |
| Điểm đúng bản nộp | FK ghép Grade → version | GV đang được phân công; score trong thang; rule Published |
| Điểm Draft không lộ | CHECK chỉ giúp trạng thái nhất quán | Mọi API list/detail/export/download/notification/comment dùng quyền và lọc đúng |
| File không lộ ngoài lớp | FK nối metadata với tài liệu/bài/phiên bản | Kiểm tra quyền qua đối tượng cha trước khi tải hoặc tạo signed URL |
| SV chỉ đọc thông báo của mình | FK recipient | Lọc recipient theo actor, không tin ID người dùng từ client |

Admin có chức năng quản lý tài khoản/lớp; **không tự suy ra Admin được xem mọi bài
nộp/điểm** khi yêu cầu chưa xác nhận. CORS, UUID và việc bucket private không thay
thế kiểm tra quyền nghiệp vụ.

## 5. Chuẩn hóa và index đề xuất

- Tên SV, email, tên lớp không lặp trong enrollment/submission/grade; truy vấn qua FK.
- GV/lớp và file/đối tượng dùng bảng nối, không lưu mảng ID hay danh sách phân cách dấu phẩy.
- Một hồ sơ nộp + nhiều phiên bản tách danh tính bài nộp khỏi sự kiện từng lần nộp.
- Score/feedback là kết quả hiện tại; trạng thái đã đọc và bản nộp hiện hành được
  suy ra từ dữ liệu gốc, tránh hai cột biểu diễn cùng một trạng thái.
- Snapshot deadline và nội dung notification là dữ liệu lịch sử có chủ đích;
  không dùng chúng làm nguồn thay thế deadline/điểm hiện tại.
- Cần review lại phụ thuộc hàm, khóa ứng viên và nullability sau Q01–Q10 để xác nhận
  3NF; đây chưa phải chứng nhận schema cuối cùng đã đạt 3NF.

Index ngoài PK/UNIQUE nên xem xét cho:

| Bảng | Index dự kiến | Truy vấn phục vụ |
| --- | --- | --- |
| `class_teachers` | teacher_id | Lớp của GV |
| `enrollments` | student_id; class_id/is_active nếu cần | Lớp của SV; danh sách lớp |
| `materials` | class_id/created_at | Nội dung theo lớp |
| `assignments` | class_id/deadline_at | Bài tập theo lớp/deadline |
| `submissions` | enrollment_id | Hồ sơ nộp của SV |
| `notifications` | recipient_id/created_at; partial index chưa đọc nếu cần | Chuông và danh sách thông báo |
| `comments` | assignment_id/created_at; submission_id/created_at | Comment theo target |
| Bảng gắn file | file_id | Tra quyền, kiểm tra tham chiếu và dọn file |

Không thêm lại index trùng PK/UNIQUE. Index thực tế chốt theo query trong D2/B1–B6.

## 6. Dữ liệu mẫu và kiểm tra trước khi đóng D1

Seed dùng dữ liệu giả và scrypt của Node.js, salt riêng từng tài khoản; không lưu
mật khẩu thuần. B1 có thể dùng helper verifyPassword hiện có. Tham số scrypt theo
[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

| Nhóm dữ liệu | Mục đích |
| --- | --- |
| 1 Admin, 2 GV, 3 SV | Kiểm tra role và quyền |
| 2 lớp; một lớp có 2 GV | Kiểm tra quan hệ nhiều GV quyền ngang nhau |
| 2 SV trong lớp A; 1 SV chỉ trong lớp B | Kiểm tra từ chối truy cập/nộp chéo lớp |
| Tài liệu/bài tập cho từng lớp | Cho Nam làm B3 trước khi B1 hoàn tất |
| Một bài chưa nộp; một hồ sơ có 2 phiên bản | Kiểm tra empty state, lịch sử, bản hiện hành |
| Một phiên bản nhiều file | Kiểm tra attachments |
| Grade Draft và Grade Published cho hai hồ sơ khác nhau | Kiểm tra không lộ điểm/feedback trước công bố |
| Thông báo đã đọc/chưa đọc; comment theo target được duyệt | Chuẩn bị module sau |

File có storage_provider = fixture, chỉ metadata, chưa có object thật và chưa kiểm
thử upload/download. Seed dùng mốc kiểm thử cố định 20/10/2026; test trước/sau hạn
so sánh submitted_at với deadline_at_submission, không dùng đồng hồ hiện tại.

Khi đã chọn công cụ và viết migration, cần kiểm tra trên **database thử riêng**:

1. Chạy toàn bộ migration trên DB trống; các bảng/FK/UNIQUE/CHECK tạo thành công.
2. Chạy lệnh migrate lần hai: không tạo lại bảng hay mất dữ liệu.
3. Chạy seed theo hướng dẫn và kiểm tra quan hệ; việc seed lại phải có chính sách rõ.
4. Từ chối ghi danh trùng, phân công trùng và version trùng.
5. Từ chối submission chéo lớp và Grade tham chiếu phiên bản của hồ sơ khác.
6. Kiểm tra score, trạng thái publish và chính sách xóa đã được nhóm duyệt.
7. Đối chiếu trường/API với Nam; Khang dùng đúng ID, trạng thái và ví dụ response.

Migration/seed và ràng buộc đã được kiểm tra qua `npm run db:test`; quy tắc còn mở
và API phân quyền chưa được nghiệm thu. Xem [verification-D1.md](verification-D1.md)
và [hướng dẫn migration](../database/migrations/README.md).
