# D1 · Quyết định đã chốt và còn mở

Ngày soạn/cập nhật: 11/10/2026. **Long đã chốt mã trường để đăng nhập, UUID cho ID
và migration SQL có phiên bản dùng pg** trong cuộc trao đổi này. Các quyết định
nghiệp vụ còn mở chưa được coi là duyệt tại CP1/CP2.

Thiết kế để review: [database-design.md](database-design.md) và
[database-erd.md](database-erd.md). Kha ghi quyết định nghiệp vụ vào Client Log/biên
bản; Nam cập nhật OpenAPI; Long cập nhật schema. Không cần gửi thông báo thay nhóm.

## Chốt kỹ thuật trước

| Mã | Câu hỏi | Đề xuất | Ai chốt / thời điểm |
| --- | --- | --- | --- |
| Q01 | Đăng nhập bằng mã SV/GV hay email? Email có bắt buộc và duy nhất không? Admin tạo sẵn hay import CSV bắt buộc MVP? | Dùng mã trường làm username; email là liên hệ. Tạo qua Admin/seed trước; CSV chỉ làm khi xác nhận bắt buộc. | Long/Nam + Kha xác nhận yêu cầu trước B1; uniqueness chốt trước migration |
| Q02 | Dùng UUID hay số tự tăng? API của Nam đang mô tả loại nào? | Đã chọn UUID cho khóa đơn, khóa ghép cho bảng nối; version là integer. | Long đã chốt; Nam đồng bộ D2 |
| Q03 | Chạy migration bằng SQL có phiên bản trên driver pg hiện có, hay dùng ORM như Prisma? | Đã chọn SQL + pg; runner lưu lịch sử, checksum, transaction và chống chạy đồng thời. | Long đã chốt; Nam dùng cùng lệnh |
| Q04 | Một tài khoản chỉ một role? Mã lớp có trùng giữa hai học kỳ không? | Một role/tài khoản; lớp unique theo code + term. Đây là đề xuất, không phải Client Log đã chốt. | Long/Nam, Kha xác nhận nghiệp vụ trước CP1 |

Q01 (trường đăng nhập), Q02 và Q03 đã được dùng trong `0001_initial_schema.sql`.
Email hiện là liên hệ tùy chọn, không UNIQUE; import CSV và Q04 vẫn cần review.
Session/token thuộc B1, chưa triển khai. Seed dùng hash scrypt thật, có thể dùng
`verifyPassword` khi viết B1; chưa có API đăng nhập.

## Chốt luồng nộp/chấm và các điểm ảnh hưởng schema

| Mã | Câu hỏi cần trả lời đầy đủ | Đề xuất để nhóm review | Mốc |
| --- | --- | --- | --- |
| Q05 | Thang điểm 10/100 hay max_score theo bài? Độ chính xác? Publish từng SV hay cả bài? Sửa điểm Published có quay Draft không, có thu hồi không? | max_score theo bài, numeric; lưu trạng thái từng hồ sơ, thao tác công bố cả bài có thể cập nhật nhiều hồ sơ trong transaction. Khi sửa kết quả đã công bố thì quay Draft, phải Publish lại. | Thiết kế CP1; Nam/Kha chốt rule trước B4 |
| Q06 | Có cho nộp lại sau deadline khi đã có bài? Có cho nộp lại sau chấm/Publish? Khi nộp lại thì giữ, ẩn hay reset điểm cũ? | Giữ hồ sơ + version bất biến; Grade chỉ rõ version được chấm. Phần quyền nộp lại/điểm cần Kha xác nhận, không tự chọn đáp án thay khách hàng. | CP2 ngày 16/10, trước Nam code B3 |
| Q07 | Đúng deadline có Late không? Giờ nhận bài là khi upload xong hay lúc bắt đầu? Sửa deadline có đổi trạng thái bài cũ không? | Dùng giờ server lúc hoàn tất; đúng deadline coi đúng hạn; snapshot deadline mỗi lần nộp để lịch sử không đổi khi GV sửa deadline. Cả ba là đề xuất cần duyệt. | CP1 thống nhất trường; CP2 chốt rule |
| Q08 | File nào được phép, tối đa bao nhiêu file/MB? Đề bài có file? Một object có được dùng chung? Xóa file xử lý thế nào? | Mỗi upload một object riêng, metadata + bảng nối; private storage; backend kiểm tra quyền theo đối tượng cha. PDF/Word/PowerPoint/file nén là yêu cầu; extension cụ thể, ảnh và các giới hạn còn chưa chốt. | Trước migration file/triển khai B2/B3 |
| Q09 | Comment trên bài tập ai xem? Comment trên bài nộp/kết quả có riêng tư không? Nhắc deadline trước bao lâu và gửi lại thế nào? | Comment bài tập cho thành viên lớp; comment hồ sơ chỉ SV chủ bài + GV của lớp; chưa thread/realtime. Không nhúng điểm Draft trong notification. Giờ nhắc do nhóm chốt ở B5. | Target comment tại CP1; quyền/rule trước B5/B6 |
| Q10 | Xóa/vô hiệu hóa user/lớp/enrollment thế nào khi đã có bài nộp/điểm? Thôi học rồi ghi danh lại có giữ lịch sử không? | Vô hiệu hóa/archiving để giữ lịch sử; chặn hard-delete cha còn dữ liệu; chỉ cascade bảng nối khi xóa cha được cho phép. Quyền xem sau thôi học cần Kha chốt riêng. | Trước migration và B1 |

## Nhật ký quyết định

Chỉ ghi các quyết định Long đã xác nhận; phần còn mở cần biên bản/spec của nhóm.

| Mã | Quyết định cuối | Người xác nhận | Ngày | Link biên bản/spec | Tác động schema |
| --- | --- | --- | --- | --- | --- |
| Q01 | Mã trường đăng nhập; email để liên hệ. CSV/chính sách tài khoản còn mở. | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | school_code chuẩn hóa trim + uppercase và UNIQUE; email nullable, không UNIQUE |
| Q02 | UUID cho khóa đơn; khóa ghép cho bảng nối/phiên bản | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | UUID DEFAULT gen_random_uuid; Nam cập nhật OpenAPI |
| Q03 | SQL có phiên bản, runner dùng pg | Long | 11/10/2026 | Cuộc trao đổi khởi động D1 | checksum SHA-256, transaction từng migration, advisory lock, CI kiểm tra DB |
| Q04 | Chưa chốt | — | — | — | role, class uniqueness |
| Q05 | Chưa chốt | — | — | — | assignments, grades |
| Q06 | Chưa chốt | — | — | — | submissions, versions, grades |
| Q07 | Chưa chốt | — | — | — | deadline snapshot, timestamp |
| Q08 | Chưa chốt | — | — | — | files, attachments |
| Q09 | Chưa chốt | — | — | — | comments, notifications |
| Q10 | Chưa chốt | — | — | — | FK delete rules, activation |

## Phạm vi implementation local trước review

- `0001` hiện dùng một role/tài khoản, code + term cho lớp, max_score theo bài,
  snapshot deadline và hai target comment như ERD. Đây là lựa chọn cho bản nháp local,
  không xác nhận các quy tắc Q04–Q10 thay Kha/Nam.
- FK dùng RESTRICT để không tự xóa dây chuyền lịch sử. Chưa có chức năng archive,
  xóa dữ liệu qua API hoặc chính sách truy cập sau thôi học.
- Có CHECK trạng thái công bố, trigger chặn nộp chéo lớp và điểm vượt max_score;
  không tự reset điểm khi nộp lại hoặc tự đổi Published về Draft khi sửa điểm.
- Không có rule đóng cửa nộp sau deadline, xử lý Late hiển thị, giới hạn file,
  quyền comment hay lịch nhắc deadline; các phần này phải chốt trước module tương ứng.
- Khi đổi schema sau khi đã áp dụng `0001`, tạo migration tiếp theo; không sửa file
  đã áp dụng để làm cho history/checksum mất nhất quán.
