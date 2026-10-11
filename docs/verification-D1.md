# D1 · Kết quả kiểm tra local ngày 11/10/2026

Long đã chọn UUID, mã trường làm username và migration SQL dùng pg.
Schema/seed được kiểm tra trên PostgreSQL 17 local; bản D1 còn chờ CP1 và review
API/prototype, không coi kết quả dưới đây là đã hoàn thành toàn bộ D1.

## Đã kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| ESLint, TypeScript, Vitest, build (`npm run check`) | Đạt; 9 test HTTP/password |
| Migration trên DB trống | Tạo 15 bảng nghiệp vụ và bảng schema_migrations |
| Chạy migrate lại | Không áp dụng trùng |
| Checksum và advisory lock | Chặn sửa file đã áp dụng, chặn runner đồng thời |
| SQL lỗi giữa migration | Rollback bảng thử và bản ghi history |
| Seed lần đầu | Đủ dữ liệu nhiều GV/lớp, version, nhiều file, Draft/Published |
| Seed lần hai | Không tăng số dòng, không thay mật khẩu/hash |
| Ràng buộc | Chặn ghi danh/phân công trùng, sai role, nộp chéo lớp, thay đổi cha phá lịch sử, sai version, điểm vượt max và metadata publish không nhất quán |
| Kiểm thử tích hợp (`npm run db:test`) | Đạt 19 nhóm kiểm tra; database tạm của lần chạy đã được dọn |
| PostgreSQL local của dự án | Đã áp dụng 0001 và seed 48 dòng; không reset/drop database dự án |

Mật khẩu demo được tạo trong `.env` bị Git bỏ qua; không in vào log/tài liệu. Chạy lại
seed giữ mật khẩu hiện có. Để đăng nhập qua API phải hoàn thành B1.

## Giới hạn và việc còn lại

- Mới kiểm tra local; workflow GitHub được cập nhật nhưng chưa push/PR để xác minh CI.
- Prototype R1 và OpenAPI D2 chưa có trong repo lúc triển khai; Nam/Khang/Kha cần review.
- Q04–Q10 vẫn mở: cấu trúc đã có bản nháp local, chưa chốt hết luật nghiệp vụ.
- Không có API auth/phân quyền/grade/upload/comment. CHECK trạng thái Grade không
  bảo đảm API không lộ Draft; phần đó phải được kiểm thử khi B1/B4 được triển khai.
- File là metadata provider fixture, chưa có object thật, chưa kiểm thử S3.
- Chưa deploy staging/AWS, chưa có migration đã được duyệt tại CP1.
- Các file còn ở working tree; không tự commit, push hoặc đóng issue D1.
