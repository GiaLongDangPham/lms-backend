# Các câu hỏi mang vào kickoff và checkpoint

## Kickoff 12/10 · Kha, Long, Nam, Khang, Cát

1. Nam và Khang chạy được stack đã chọn chưa? Có vướng TypeScript/Docker không?
2. Lịch 4h/ngày hai tuần đầu của Long có phù hợp? Giờ review PR/kickoff có cần phân
   bổ thêm? Ai hỗ trợ nếu phát sinh lỗi môi trường?
3. Ai có quyền repo/board/Actions? Script tạo 33 issue, weekly log và baseline mới
   nhất nằm ở đâu? Chốt GitHub + Tracker làm nguồn theo dõi thực thi.
4. Chọn dịch vụ FE, BE, PostgreSQL và lưu file nào cho staging? Ai giữ tài khoản,
   chi phí/budget, biến môi trường? Có thể duy trì demo tới 07/12 không?
5. Long chốt auth theo session hay token ở B1 cùng Nam/Khang: thời hạn đăng nhập,
   logout, cách FE gọi API, kiểm tra role và quyền trong lớp như thế nào?
6. Tạo tài khoản sẵn bằng seed/admin/import? Import CSV có bắt buộc MVP không,
   mẫu dữ liệu và cách cấp mật khẩu là gì?
7. T1b ngày 19–20/10 bàn giao từng phần thế nào để Long kiểm tra B1 trước hạn 20/10?

## Đối chiếu D1/D2 trước CP1 15/10 · Long và Nam

8. Thống nhất tên thực thể, kiểu ID, date-time/timezone, enum và JSON lỗi ngay 13/10.
9. Quan hệ nhiều GV–lớp dùng bảng liên kết nào? Enrollment chỉ SV hay gồm cả GV?
10. Một submission là một lần nộp hay bài hiện hành? Chọn current version, lịch sử,
    nhiều file, khóa unique và điểm liên kết bài nộp nào?
11. Chọn công cụ migration và cách seed đồng bộ; Nam chạy B3 với seed thế nào khi
    B1 chưa hoàn tất? DB schema phải chạy lại được trên database trống.
12. Upload: loại file cụ thể, số lượng, dung lượng, tải file có kiểm tra quyền lớp,
    lưu file bền vững và xử lý thay/xóa file ra sao?
13. Mock sinh từ OpenAPI nào, cách chạy và URL? FE shell dùng mock ở CP1; ghi rõ
    ngoại lệ F0 trong DoD chung, các module FE chuyển sang API thật theo lịch.

## CP2 16/10 · Nam trình bày, Kha duyệt; Long hỗ trợ thiết kế

14. Đã có bài nộp rồi thì có cho thay bài sau deadline không? Client Log chỉ chốt
    nộp lại trước deadline và cho nộp trễ, chưa chốt trường hợp kết hợp này.
15. Đúng thời điểm deadline tính đúng hạn hay Late? Server quyết định thời gian?
    Khi GV sửa deadline thì Late của bài đã nộp có thay đổi không?
16. Nộp lại sau khi được chấm sẽ giữ/hủy điểm, đặt Draft lại hay không cho nộp?

## Rule điểm · chốt sớm, kiểm tra ở CP3 27/10

17. Thang điểm/độ chính xác, feedback và Publish theo SV hay toàn bài?
18. Sửa điểm đã Publish có về Draft hay vẫn công khai? Có thu hồi Publish không?
19. Grade gắn submission version nào? Mọi API/list/download liên quan có bảo vệ
    điểm/feedback Draft trước SV, kể cả SV ngoài lớp, không?

Các câu hỏi này chưa phải quyết định nghiệp vụ. Kha ghi quyết định vào Client Log/
biên bản checkpoint, Nam cập nhật OpenAPI, Long cập nhật schema khi có ảnh hưởng.
