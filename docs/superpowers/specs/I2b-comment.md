# I2b - Tích hợp Comment và chuẩn bị deploy

Ngày 21/11/2026; Long; nhánh BE/FE `I2b-tich-hop-comment`, nối tiếp I2a.
Mục tiêu: FE F6 + B6 API thật, thảo luận chung theo từng assignment theo TestCase
Kha duyệt 19/11 (TC-CM-01..07). SV cùng lớp và GV phân công đọc/gửi, ngoài lớp
404, ADMIN 403, body plain text, còn thảo luận sau công bố và giữ lịch sử.

Backend cũng có API submission comment riêng tư cho chủ bài/GV; giữ chính sách
an toàn này, không mở dữ liệu bài nộp cho cả lớp và không bắt F6 làm UI riêng.
OpenAPI bỏ cờ Q09 pending lỗi thời ở hai operation đó, ghi rõ authorization thực tế;
quyết định về scope F6 dựa trên TestCase, không bịa approval lịch sử của riêng API.

Giữ contract, không thêm websocket/chat/thread, không đổi component system.
Browser harness I2a mở rộng kiểm tra POST/GET, reload, GV/SV cùng thấy, ngoài lớp
không thấy và HTML-like content được render text. Không mock HTTP.

User xác nhận chưa deploy. Chuẩn bị Docker build Node 22, Nginx SPA fallback và
reverse proxy /api, compose cho API/FE/DB/private MinIO, migration và bucket init.
Không push image hay deploy cloud; cấu hình bind localhost cho reverse proxy TLS.
Secrets chỉ qua env; không commit .env. Chạy compose config/build nếu runtime có.
Acceptance local không phải nghiệm thu máy chủ; ghi rõ gate còn lại.
