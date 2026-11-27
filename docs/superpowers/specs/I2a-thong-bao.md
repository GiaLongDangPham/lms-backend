# I2a - Tích hợp Thông báo

Ngày 21/11/2026; Long thực hiện trực tiếp, không sub-agent. Nhánh hai repo:
`I2a-tich-hop-thong-bao`, từ develop BE ffd500c và FE 32a0a61.

## Mục tiêu

Nối B5/F5 bằng API thật, kiểm tra tạo bài, nhắc deadline, công bố/sửa điểm,
đánh dấu đã đọc và phân quyền. Sửa Bug-09 QA 19/11: nội dung thông báo cần tên
bài, lớp và hạn (Asia/Ho_Chi_Minh); menu sinh viên có số chưa đọc.

## Thiết kế

Giữ Express/pg + React và schema Notification hiện tại. Nội dung là snapshot
văn bản lấy từ assignment/class trong transaction tạo sự kiện; không nhúng điểm
hoặc feedback Draft. Nhắc deadline vẫn một lần/người/deadline trong (0,24h],
worker 5 phút và PostgreSQL làm đồng hồ. Không thêm email/realtime hay schema.
FE giữ số chưa đọc theo phiên SV, refresh khi chuyển route/focus và khi đánh dấu
đọc; hủy callback cũ khi logout/đổi user để tránh rò số liệu phiên trước.

Lựa chọn: giữ API đang có thay vì thêm count endpoint; tải inbox phân trang là
đủ cho quy mô MVP. Không polling realtime. Sai sót mạng không được hiển thị 0
như một giá trị đã xác nhận. Hiện số đọc được gần nhất hoặc không hiện badge.

## Nghiệm thu

- HTTP PostgreSQL thật chứng minh đủ ba sự kiện, context, UTC+7 và privacy.
- Browser gọi FE thật + BE thật, không route mock, chứng minh badge và read persistence.
- Unit/static/build hai repo, full API và migration DB đạt trước commit/push.
- User xác nhận chưa deploy. Local acceptance không được gọi là staging Done;
  bàn giao runbook cấu hình deploy, migration 0007, cookie/CORS và worker.
- Không chỉnh tracker hoặc dữ liệu dự án, chỉ dùng DB test tạo riêng/xóa đúng DB.
