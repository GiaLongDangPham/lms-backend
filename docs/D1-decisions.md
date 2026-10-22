# D1 · Quyết định đã chốt và còn mở

Cập nhật: 17/10/2026. Long đã chốt mã trường đăng nhập, UUID, SQL + pg, JWT và các
rule Client Log 18–20/L04/L05/L14/L20 trong cuộc trao đổi này. Chỉ những rule ghi rõ
đã chốt bên dưới được coi là đầu vào triển khai; các phần khác vẫn chờ nhóm duyệt.

Thiết kế để review: [database-design.md](database-design.md) và
[database-erd.md](database-erd.md). Kha ghi quyết định nghiệp vụ vào Client Log/biên
bản; Nam cập nhật OpenAPI; Long cập nhật schema. Không cần gửi thông báo thay nhóm.

## Chốt kỹ thuật trước

| Mã | Câu hỏi | Đề xuất | Ai chốt / thời điểm |
| --- | --- | --- | --- |
| Q01 | Đăng nhập bằng mã SV/GV hay email? Email có bắt buộc và duy nhất không? Admin tạo sẵn hay import CSV bắt buộc MVP? | Dùng mã trường làm username; email là liên hệ. Tạo qua Admin/seed trước; CSV chỉ làm khi xác nhận bắt buộc. | Long/Nam + Kha xác nhận yêu cầu trước B1; uniqueness chốt trước migration |
| Q02 | Dùng UUID hay số tự tăng? API của Nam đang mô tả loại nào? | Đã chọn UUID cho khóa đơn, khóa ghép cho bảng nối; version là integer. | Long đã chốt; Nam đồng bộ D2 |
| Q03 | Chạy migration bằng SQL có phiên bản trên driver pg hiện có, hay dùng ORM như Prisma? | Đã chọn SQL + pg; runner lưu lịch sử, checksum, transaction và chống chạy đồng thời. | Long đã chốt; Nam dùng cùng lệnh |
| Q04 | Một tài khoản chỉ một role? Mã lớp có trùng giữa học phần/học kỳ không? | Một role/tài khoản trong MVP; L20 đã chốt lớp unique theo course_code + code + term, thêm description. | Long chốt L20 ngày 17/10; chính sách nhiều role chưa có yêu cầu |

Q01 (trường đăng nhập), Q02 và Q03 đã được dùng trong `0001_initial_schema.sql`.
Email hiện là liên hệ tùy chọn, không UNIQUE; import CSV vẫn cần review.
Long chốt JWT cho B1 ngày 14/10/2026; Admin tạo SV/GV bằng mật khẩu ban đầu,
người dùng đổi mật khẩu. API đăng nhập dùng lại `verifyPassword`/scrypt của D1.
Long cũng chốt vô hiệu hóa tài khoản/ghi danh để giữ lịch sử: SV ngừng ghi danh
mất quyền vào lớp, GV được phân công vẫn xem lịch sử. Ghi danh lại giữ enrollment ID.
Chi tiết contract/refresh token và cách kiểm thử nằm trong README, không tạo tài liệu B1 riêng.

## Chốt luồng nộp/chấm và các điểm ảnh hưởng schema

| Mã | Câu hỏi cần trả lời đầy đủ | Đề xuất để nhóm review | Mốc |
| --- | --- | --- | --- |
| Q05 | Thang điểm/độ chính xác? Công bố và sửa điểm thế nào? | max_score theo bài, numeric. Đã chốt công bố cả bài atomic; bài đã nộp chưa chấm chặn toàn bộ. Sửa Published giữ Published, SV thấy ngay, lưu lịch sử bất biến; SV chỉ xem snapshot Published. Tự gán 0 cho SV active chưa nộp khi công bố. Độ chính xác/thang mặc định còn mở. | Long 17/10; Client Log 19–20, L04/L14, D2 532f983 |
| Q06 | Có cho nộp lại sau deadline/chấm/Publish? | Có grade Draft/Published hoặc công bố toàn bài thì khóa nộp mới. Một kết quả hiện tại/bài tập/ghi danh; version bất biến. Quyền nộp lại sau deadline khi chưa chấm còn mở. | Long 17/10; Client Log 18, L03 |
| Q07 | Đúng deadline có Late không? Giờ nhận bài là khi upload xong hay lúc bắt đầu? Sửa deadline có đổi trạng thái bài cũ không? | Dùng giờ server lúc hoàn tất; đúng deadline coi đúng hạn; snapshot deadline mỗi lần nộp để lịch sử không đổi khi GV sửa deadline. Cả ba là đề xuất cần duyệt. | CP1 thống nhất trường; CP2 chốt rule |
| Q08 | File nào được phép, tối đa bao nhiêu file/MB? Đề bài có file? Một object có được dùng chung? Xóa file xử lý thế nào? | Mỗi upload một object riêng, metadata + bảng nối; private storage; backend kiểm tra quyền theo đối tượng cha. PDF/Word/PowerPoint/file nén là yêu cầu; extension cụ thể, ảnh và các giới hạn còn chưa chốt. | Trước migration file/triển khai B2/B3 |
| Q09 | Comment trên bài tập ai xem? Comment trên bài nộp/kết quả có riêng tư không? Nhắc deadline trước bao lâu và gửi lại thế nào? | Comment bài tập cho thành viên lớp; comment hồ sơ chỉ SV chủ bài + GV của lớp; chưa thread/realtime. Không nhúng điểm Draft trong notification. Giờ nhắc do nhóm chốt ở B5. | Target comment tại CP1; quyền/rule trước B5/B6 |
| Q10 | Xóa/vô hiệu hóa user/lớp/enrollment thế nào khi đã có bài nộp/điểm? Thôi học rồi ghi danh lại có giữ lịch sử không? | Vô hiệu hóa/archiving để giữ lịch sử; chặn hard-delete cha còn dữ liệu; chỉ cascade bảng nối khi xóa cha được cho phép. Quyền xem sau thôi học cần Kha chốt riêng. | Trước migration và B1 |

**L05 đã chốt giữ:** note tùy chọn tối đa 2000 ký tự nằm trên từng version nộp bài,
chỉ SV chủ bài và GV được phân công đọc; Admin không có quyền đọc note.
**Long giao chọn chính sách sửa 0:** GV được sửa kết quả không có bài nộp, nguồn hiện
tại chuyển MANUAL, giữ Published/null submission/null version; lịch sử giữ nguồn
AUTO_ZERO_NO_SUBMISSION và không mở nộp lại. Không tạo submission/version giả.

## Nhật ký quyết định

Chỉ ghi các quyết định Long đã xác nhận; phần còn mở cần biên bản/spec của nhóm.

| Mã | Quyết định cuối | Người xác nhận | Ngày | Link biên bản/spec | Tác động schema |
| --- | --- | --- | --- | --- | --- |
| Q01 | Mã trường đăng nhập; email để liên hệ. CSV/chính sách tài khoản còn mở. | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | school_code chuẩn hóa trim + uppercase và UNIQUE; email nullable, không UNIQUE |
| Q02 | UUID cho khóa đơn; khóa ghép cho bảng nối/phiên bản | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | UUID DEFAULT gen_random_uuid; Nam cập nhật OpenAPI |
| Q03 | SQL có phiên bản, runner dùng pg | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | checksum SHA-256, transaction từng migration, advisory lock, CI kiểm tra DB |
| Q04 | L20: UNIQUE(course_code, code, term), description nullable | Long | 17/10/2026 | Ảnh danh sách lệch L20 | classes; mapping bắt buộc cho lớp cũ thật |
| Q05 | Công bố atomic, tự gán 0, sửa Published vẫn Published và lưu lịch sử; độ chính xác còn mở | Long | 17/10/2026 | Client Log 19–20, D2 532f983 | grades assignment/enrollment, source/revision; grade_history |
| Q06 | Khóa nộp khi đã có grade hoặc đã công bố; deadline chưa chốt hết | Long | 17/10/2026 | Client Log 18, L03 | trigger version; assignments.results_published_at |
| Q07 | Chưa chốt | — | — | — | deadline snapshot, timestamp |
| Q08 | Chưa chốt | — | — | — | files, attachments |
| Q09 | Chưa chốt | — | — | — | comments, notifications |
| Q10 | Vô hiệu hóa user/ghi danh, ghi danh lại giữ ID; archive lớp còn mở | Long | 14/10/2026 | Trao đổi B1 | B1 revoke session, FK giữ lịch sử |

## Phạm vi implementation local trước review

- `0001` giữ nguyên checksum. `0002` thêm auth. `0003` thay uniqueness lớp và mô hình
  điểm theo các quyết định 17/10; snapshot deadline/hai target comment vẫn giữ.
- FK dùng RESTRICT để không tự xóa dây chuyền lịch sử. B1 có API vô hiệu hóa
  tài khoản/ghi danh và kiểm tra quyền như Long chốt ngày 14/10; chưa có archive lớp
  hoặc hard-delete qua API.
- CHECK/trigger chặn nộp chéo lớp, điểm vượt max_score, sửa/xóa lịch sử, đổi danh tính
  kết quả và nộp sau chấm. Không đưa Published về Draft.
- Không có rule đóng cửa nộp sau deadline, xử lý Late hiển thị, giới hạn file,
  quyền comment hay lịch nhắc deadline; các phần này phải chốt trước module tương ứng.
- Khi đổi schema sau khi đã áp dụng `0001`, tạo migration tiếp theo; không sửa file
  đã áp dụng để làm cho history/checksum mất nhất quán.
