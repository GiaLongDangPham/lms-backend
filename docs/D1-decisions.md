# D1 · Quyết định đã chốt và còn mở

Cập nhật: 24/10/2026. Long đã chốt mã trường để đăng nhập, UUID, migration SQL có
phiên bản dùng pg và mô hình lớp ở L20. Nhóm đã chốt thêm Q05-Q08 cho bài tập, bài
nộp, điểm và file. Các phần khác vẫn chờ duyệt.

Thiết kế để review: [database-design.md](database-design.md) và
[database-erd.md](database-erd.md). Kha ghi quyết định nghiệp vụ vào Client Log/biên
bản; Nam cập nhật OpenAPI; Long cập nhật schema. Không cần gửi thông báo thay nhóm.

## Chốt kỹ thuật trước

| Mã | Câu hỏi | Đề xuất | Ai chốt / thời điểm |
| --- | --- | --- | --- |
| Q01 | Đăng nhập bằng mã SV/GV hay email? Email có bắt buộc và duy nhất không? Admin tạo sẵn hay import CSV bắt buộc MVP? | Dùng mã trường làm username; email là liên hệ. Tạo qua Admin/seed trước; CSV chỉ làm khi xác nhận bắt buộc. | Long/Nam + Kha xác nhận yêu cầu trước B1; uniqueness chốt trước migration |
| Q02 | Dùng UUID hay số tự tăng? API của Nam đang mô tả loại nào? | Đã chọn UUID cho khóa đơn, khóa ghép cho bảng nối; version là integer. | Long đã chốt; Nam đồng bộ D2 |
| Q03 | Chạy migration bằng SQL có phiên bản trên driver pg hiện có, hay dùng ORM như Prisma? | Đã chọn SQL + pg; runner lưu lịch sử, checksum, transaction và chống chạy đồng thời. | Long đã chốt; Nam dùng cùng lệnh |
| Q04 | Một tài khoản chỉ một role? Mã lớp có trùng giữa học phần/học kỳ không? | Một role/tài khoản trong MVP; L20 chốt lớp unique theo course_code + code + term, description nullable. | Long chốt L20 ngày 17/10/2026 |

Q01 (trường đăng nhập), Q02 và Q03 đã được dùng trong `0001_initial_schema.sql`.
Email hiện là liên hệ tùy chọn, không UNIQUE; import CSV vẫn cần review. `0002` và
B1 triển khai JWT access token, refresh session, đổi mật khẩu và thu hồi session.

## Chốt luồng nộp/chấm và các điểm ảnh hưởng schema

| Mã | Câu hỏi cần trả lời đầy đủ | Đề xuất để nhóm review | Mốc |
| --- | --- | --- | --- |
| Q05 | Thang điểm 10/100 hay max_score theo bài? Độ chính xác? Publish từng SV hay cả bài? Sửa điểm Published có quay Draft không, có thu hồi không? | Đã chốt max_score theo bài; điểm tối đa hai chữ số thập phân; công bố toàn bài tập trong một transaction. Mọi lần tạo/sửa điểm đều lưu history. Sửa điểm Published giữ Published và ghi revision mới. Không có unpublish cho tới khi được yêu cầu riêng. | Chốt 24/10/2026; đồng bộ D2 và migration mới trước B4 |
| Q06 | Có cho nộp lại sau deadline khi đã có bài? Có cho nộp lại sau chấm/Publish? Khi nộp lại thì giữ, ẩn hay reset điểm cũ? | Giữ version bất biến. Bài đã có Grade, kể cả Draft, không được nộp lại. Nếu đã có submission thì chỉ tạo version mới đến deadline hiện tại; quá hạn phải chờ GV gia hạn. Lần nộp đầu vẫn có thể Late. | Client Log #18 + chốt bổ sung 24/10/2026 |
| Q07 | Đúng deadline có Late không? Giờ nhận bài là khi upload xong hay lúc bắt đầu? Sửa deadline có đổi trạng thái bài cũ không? | Đúng deadline là đúng hạn. submitted_at là giờ server khi transaction version + file links commit thành công. GV được sửa deadline dù đã có submission; bản cũ giữ snapshot và Late lịch sử, deadline mới chỉ chi phối lần nộp tương lai. | Chốt 24/10/2026 |
| Q08 | File nào được phép, tối đa bao nhiêu file/MB? Đề bài có file? Một object có được dùng chung? Xóa file xử lý thế nào? | Allowlist tài liệu, bảng tính, slide, text/data, source, ảnh và ZIP; `.docx`, `.xls`, `.cpp`, `.py` được phép. Chặn executable, system script, Office macro, file không đuôi/đuôi lạ, `.rar`, `.7z` và MIME/nội dung không khớp. 25 MiB/file; 10 file/resource hoặc version; 100 MiB/version. ZIP tối đa 100 entry, 200 MiB giải nén, tỷ lệ 20:1; chặn archive lồng, symlink, path traversal và file cấm bên trong. Private S3-compatible storage; PENDING → ATTACHED, orphan PENDING sau 24 giờ, DELETE_PENDING để retry. | Chốt 24/10/2026; cần migration mới trước B2/B3 |
| Q09 | Comment trên bài tập ai xem? Comment trên bài nộp/kết quả có riêng tư không? Nhắc deadline trước bao lâu và gửi lại thế nào? | Comment bài tập cho thành viên lớp; comment hồ sơ chỉ SV chủ bài + GV của lớp; chưa thread/realtime. Không nhúng điểm Draft trong notification. Giờ nhắc do nhóm chốt ở B5. | Target comment tại CP1; quyền/rule trước B5/B6 |
| Q10 | Xóa/vô hiệu hóa user/lớp/enrollment thế nào khi đã có bài nộp/điểm? Thôi học rồi ghi danh lại có giữ lịch sử không? | Vô hiệu hóa/archiving để giữ lịch sử; chặn hard-delete cha còn dữ liệu; chỉ cascade bảng nối khi xóa cha được cho phép. Quyền xem sau thôi học cần Kha chốt riêng. Khi tạo enrollment hoặc kích hoạt lại sau khi bài đã công bố, transaction tạo kết quả 0 Published còn thiếu; giữ grade/history đã có, không tạo submission/version giả và không mở khóa nộp. | Quy tắc ghi danh sau công bố chốt 24/10/2026; quyền xem sau thôi học vẫn cần Kha chốt |

L05 về ghi chú gửi giảng viên chưa được Kha chốt. B3 không expose `note` trong public
API; cột nullable do migration cũ tạo ra không được dùng làm hợp đồng cho frontend.

## Nhật ký quyết định

Chỉ ghi các quyết định Long đã xác nhận; phần còn mở cần biên bản/spec của nhóm.

| Mã | Quyết định cuối | Người xác nhận | Ngày | Link biên bản/spec | Tác động schema |
| --- | --- | --- | --- | --- | --- |
| Q01 | Mã trường đăng nhập; email để liên hệ. CSV/chính sách tài khoản còn mở. | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | school_code chuẩn hóa trim + uppercase và UNIQUE; email nullable, không UNIQUE |
| Q02 | UUID cho khóa đơn; khóa ghép cho bảng nối/phiên bản | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | UUID DEFAULT gen_random_uuid; Nam cập nhật OpenAPI |
| Q03 | SQL có phiên bản, runner dùng pg | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | checksum SHA-256, transaction từng migration, advisory lock, CI kiểm tra DB |
| Q04 | UNIQUE(course_code, code, term), description nullable | Long | 17/10/2026 | MaTran_Lech L20 | classes; mapping bắt buộc cho lớp cũ |
| Q05 | Chốt một phần; unpublish chưa yêu cầu | Nhóm | 24/10/2026 | Trao đổi cập nhật specification | assignments, grades, grade history |
| Q06 | Đã chốt | Nhóm | 24/10/2026 | Client Log #18 + trao đổi cập nhật specification | submissions, versions, grades |
| Q07 | Đã chốt | Nhóm | 24/10/2026 | Trao đổi cập nhật specification | deadline snapshot, timestamp |
| Q08 | Đã chốt | Nhóm | 24/10/2026 | Trao đổi cập nhật specification | files, lifecycle, attachments |
| Q09 | Chưa chốt | — | — | — | comments, notifications |
| Q10 | Vô hiệu hóa user/ghi danh và ghi danh lại giữ enrollment ID; thêm 0 Published còn thiếu khi ghi danh vào bài đã công bố | Nhóm | 24/10/2026 | Trao đổi cập nhật specification | session revocation, FK giữ lịch sử; transaction tạo grade |

## Phạm vi implementation local trước review

- `0001`–`0003` giữ nguyên; `0004_b3_assignments_submissions.sql` áp dụng precision
  điểm hai chữ số, lifecycle file, quy tắc gắn file và giới hạn dung lượng/số lượng.
  B3 service/repository cùng coverage tập trung đã có trong nhánh.
- `0005_assignment_publication_actor.sql` lưu và backfill người công bố toàn bài,
  buộc thời điểm/người công bố đi cùng nhau và giữ provenance công bố bất biến.
  Assignment service/repository liên quan đã có trong nhánh; actor chỉ lưu nội bộ
  trong database.
- FK dùng RESTRICT để không tự xóa dây chuyền lịch sử. B1 có API vô hiệu hóa tài
  khoản/ghi danh; chưa có archive lớp hoặc hard-delete qua API.
- Khi đổi schema sau khi đã áp dụng `0001`, tạo migration tiếp theo; không sửa file
  đã áp dụng để làm cho history/checksum mất nhất quán.
